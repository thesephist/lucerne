` twitter API adapter `

std := load('../vendor/std')
quicksort := load('../vendor/quicksort')
json := load('../vendor/json')
percent := load('../vendor/percent')

log := std.log
f := std.format
cat := std.cat
map := std.map
each := std.each
reduce := std.reduce
sort := quicksort.sort
deJSON := json.de
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

` retrieves a timeline for a user `
retrieveUser := (screenName, cb) => (
	request := {
		method: 'GET'
		url: 'https://api.twitter.com/1.1/statuses/user_timeline.json'
	}

	params := extendDefaultTweetParams({
		'screen_name': screenName
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
` NOTE: on building queries, see https://developer.twitter.com/en/docs/twitter-api/tweets/search/integrate/build-a-rule `
search := (query, cb) => (
	request := {
		method: 'GET'
		url: 'https://api.twitter.com/1.1/search/tweets.json'
	}

	params := extendDefaultTweetParams({
		'q': query
		'result_type': 'recent'
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

