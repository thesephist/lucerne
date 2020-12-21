` twitter API adapter `

std := load('../vendor/std')
str := load('../vendor/str')
quicksort := load('../vendor/quicksort')
json := load('../vendor/json')
percent := load('../vendor/percent')

log := std.log
f := std.format
cat := std.cat
map := std.map
each := std.each
filter := std.filter
reduce := std.reduce
some := std.some
split := str.split
sort := quicksort.sort
deJSON := json.de
serJSON := json.ser
pctEncode := percent.encode

sig := load('sig')
cache := load('cache')
credentials := load('../credentials')

sign := sig.sign

DefaultTweetParams := {
	` acccommodate tweets >140 characters `
	'tweet_mode': 'extended'
	'exclude_replies': 'false'
	'include_rts': '1'
	'count': '25'
}

` global request cache, re: Twitter's API rate limit `
CacheGet := (cache.new)()

serializeParams := params => cat(sort(map(keys(params), k => k + '=' + params.(k))), '&')
formatKey := (url, params) => url + '?' + serializeParams(params)
extend := (base, obj) => reduce(keys(obj), (acc, k) => acc.(k) := obj.(k), base)
extendDefaultTweetParams := obj => extend(DefaultTweetParams, obj)

` send a tweet. Will log an error if status is too long. `
send := (status, cb) => (
	request := {
		method: 'POST'
		url: 'https://api.twitter.com/1.1/statuses/update.json'
	}

	params := {
		status: status
	}

	req(sign(request, params), evt => evt.type :: {
		'resp' -> cb(evt.data)
		'error' -> cb(evt.message)
	})
)

` retrieve the timeline for the logged-in user `
retrieve := cb => (
	request := {
		method: 'GET'
		url: 'https://api.twitter.com/1.1/statuses/home_timeline.json'
	}

	params := DefaultTweetParams

	CacheGet(
		formatKey(request.url, params)
		cb => req(sign(request, params), evt => evt.type :: {
			'resp' -> cb(evt.data.body)
			'error' -> cb(())
		})
		data => cb(data)
	)
)

` search Twitter for a non-exhaustive match against queries `
` TODO: migrate to 30-day premium or v2 full archive search:
	https://developer.twitter.com/en/docs/twitter-api/tweets/full-archive-search/api-reference/get-tweets-search-all`
search := (query, cb) => (
	pcs := split(query, ' ')
	hasTop? := some(map(pcs, pc => pc = 'sort:top'))
	query := (hasTop? :: {
		false -> query
		_ -> cat(filter(map(pcs, pc => pc :: {
			'sort:top' -> ''
			'sort:recent' -> ''
			_ -> pc
		}), pc => ~(pc = '')), ' ')
	})

	request := {
		method: 'GET'
		url: 'https://api.twitter.com/1.1/search/tweets.json'
	}

	params := extendDefaultTweetParams({
		'q': query
		'result_type': hasTop? :: {
			true -> 'popular'
			false -> 'recent'
		}
	})

	CacheGet(
		formatKey(request.url, params)
		cb => req(sign(request, params), evt => evt.type :: {
			'resp' -> cb(evt.data.body)
			'error' -> cb(evt.message)
		})
		data => cb(data)
	)
)

conversation := (tweetID, cb) => (
	getConversationID := (tweetID, cb) => (
		request := {
			method: 'GET'
			url: f('https://api.twitter.com/2/tweets/{{0}}', [tweetID])
		}
		params := {
			'tweet.fields': 'conversation_id'
		}
		` TODO: turn this wrapper into a fn `
		CacheGet(
			formatKey(request.url, params)
			cb => req(sign(request, params), evt => evt.type :: {
				'resp' -> cb(evt.data.body)
				'error' -> cb(evt.message)
			})
			data => cb(data)
		)
	)

	getTweetsInConversation := (conversationID, cb) => (
		request := {
			method: 'GET'
			url: 'https://api.twitter.com/2/tweets/search/recent'
		}
		params := {
			'max_results': '25'
			'query': f('conversation_id:{{0}}', [conversationID])
		}
		CacheGet(
			formatKey(request.url, params)
			cb => req(sign(request, params), evt => evt.type :: {
				'resp' -> cb(evt.data.body)
				'error' -> cb(evt.message)
			})
			data => cb(data)
		)
	)

	lookupTweetsByID := (ids, cb) => (
		request := {
			method: 'GET'
			url: 'https://api.twitter.com/1.1/statuses/lookup.json'
		}
		params := {
			'id': cat(ids, ',')
			` not directly extending v1.1 default params as the
				count param does not apply here `
			'tweet_mode': 'extended'
			'exclude_replies': 'false'
			'include_rts': '0'
		}
		CacheGet(
			formatKey(request.url, params)
			cb => req(sign(request, params), evt => evt.type :: {
				'resp' -> cb(evt.data.body)
				'error' -> cb(evt.message)
			})
			data => cb(data)
		)
	)

	Err := msg => serJSON({error: 'Could not get conversation: ' + msg})
	getConversationID(tweetID, resp => (
		jsonResp := deJSON(resp) :: {
			() -> cb(Err(resp))
			_ -> jsonResp.data :: {
				() -> cb(Err('no tweet with that ID'))
				_ -> getTweetsInConversation(jsonResp.data.'conversation_id', resp => (
					jsonResp := deJSON(resp) :: {
						() -> cb(Err('invalid response from Twitter'))
						_ -> data := jsonResp.data :: {
							() -> cb('[]')
							[] -> cb('[]')
							_ -> lookupTweetsByID(map(jsonResp.data, tw => tw.id), cb)
						}
					}
				))
			}
		}
	))
)

trends := cb => (
	request := {
		method: 'GET'
		url: f('https://api.twitter.com/2/users/{{UserID}}/tweets', credentials)
	}

	params := {
		'max_results': '7'
		'exclude': 'retweets,replies'
		'tweet.fields': 'attachments,created_at,entities,non_public_metrics,public_metrics,organic_metrics,text'
	}

	CacheGet(
		formatKey(request.url, params)
		cb => req(sign(request, params), evt => evt.type :: {
			'resp' -> cb(evt.data.body)
			'error' -> cb(evt.message)
		})
		data => cb(data)
	)
)

