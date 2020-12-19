` twitter API adapter `

std := load('../vendor/std')
quicksort := load('../vendor/quicksort')
json := load('../vendor/json')

log := std.log
cat := std.cat
map := std.map
each := std.each
sort := quicksort.sort
deJSON := json.de

sig := load('sig')
cache := load('cache')

sign := sig.sign

` global request cache, re: Twitter's API rate limit `
CacheGet := (cache.new)()

serializeParams := params => cat(sort(map(keys(params), k => k + '=' + params.(k))), '&')
formatKey := (url, params) => url + '?' + serializeParams(params)

` TODO: migrate these early on to the v2 APIs which include conversation data
	and metrics, both of which we want for Lucerne.

	NOTE: the home_timeline and status update APIs do not yet have v2 replacements. `

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

	params := {
		'tweet_mode': 'extended'
		'exclude_replies': 'false'
		'include_rts': '1'
		'count': '100'
		'screen_name': screenName
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

` retrieve the timeline for the logged-in user `
retrieve := cb => (
	request := {
		method: 'GET'
		url: 'https://api.twitter.com/1.1/statuses/home_timeline.json'
	}

	params := {
		` acccommodate tweets >140 characters `
		'tweet_mode': 'extended'
		'exclude_replies': 'false'
		'include_rts': '1'
		'count': '100'
	}

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
search := (query, cb) => (
	request := {
		method: 'GET'
		url: 'https://api.twitter.com/2/tweets/search/recent'
	}

	params := {
		'max_results': '100'
		'query': query
	}

	` TODO: Either match the v2 API response shape to v1.1, or revert to v1.1 search API until later `
	CacheGet(
		formatKey(request.url, params)
		cb => req(sign(request, params), evt => evt.type :: {
			'resp' -> cb(evt.data.body)
			'error' -> cb(evt.message)
		})
		data => cb(data)
	)
)

