` twitter API adapter `

std := load('../vendor/std')
str := load('../vendor/str')
quicksort := load('../vendor/quicksort')
json := load('../vendor/json')
percent := load('../vendor/percent')

log := std.log
f := std.format
clone := std.clone
cat := std.cat
append := std.append
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

serializeParams := params => cat(sort(map(keys(params), k => k + '=' + params.(k))), '&')
formatKey := (url, params) => url + '?' + serializeParams(params)
extend := (base, obj) => reduce(keys(obj), (acc, k) => acc.(k) := obj.(k), clone(base))
extendDefaultTweetParams := obj => extend(DefaultTweetParams, obj)
addPropIfPresent := (obj, key, val) => val :: {
	() -> obj
	_ -> obj.(key) := val
}

` global request cache, re: Twitter's API rate limit `
CacheGet := (cache.new)()
cacheResp := (request, params, cb) => CacheGet(
	formatKey(request.url, params)
	cb => req(sign(request, params), evt => evt.type :: {
		'resp' -> cb(evt.data.body)
		'error' -> cb(())
	})
	cb
)

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
retrieve := (max, cb) => (
	request := {
		method: 'GET'
		url: 'https://api.twitter.com/1.1/statuses/home_timeline.json'
	}

	params := extendDefaultTweetParams({})
	addPropIfPresent(params, 'max_id', max)

	cacheResp(request, params, cb)
)

` search Twitter for a non-exhaustive match against queries `
` NOTE: later, migrate to 30-day premium or v2 full archive search:
	https://developer.twitter.com/en/docs/twitter-api/tweets/full-archive-search/api-reference/get-tweets-search-all`
search := (query, max, cb) => (
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
	addPropIfPresent(params, 'max_id', max)

	cacheResp(request, params, cb)
)

conversation := (tweetID, max, cb) => (
	getConversationID := (tweetID, cb) => (
		request := {
			method: 'GET'
			url: f('https://api.twitter.com/2/tweets/{{0}}', [tweetID])
		}
		params := {
			'tweet.fields': 'conversation_id'
		}
		cacheResp(request, params, cb)
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
		addPropIfPresent(params, 'until_id', max)
		cacheResp(request, params, cb)
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
		cacheResp(request, params, cb)
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
							_ -> lookupTweetsByID(append(map(jsonResp.data, tw => tw.id), [tweetID]), cb)
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
		'max_results': '6'
		'exclude': 'retweets,replies'
		'tweet.fields': 'attachments,created_at,entities,non_public_metrics,public_metrics,organic_metrics,text'
	}

	cacheResp(request, params, cb)
)

followers := cb => (
	request := {
		method: 'GET'
		url: f('https://api.twitter.com/2/users/{{UserID}}/followers', credentials)
	}

	params := {
		'max_results': '10'
		'user.fields': 'description,entities,id,location,name,profile_image_url,public_metrics,url,username'
	}

	cacheResp(request, params, cb)
)

