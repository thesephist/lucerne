` twitter API adapter `

std := load('../vendor/std')
json := load('../vendor/json')

log := std.log
each := std.each
deJSON := json.de

sig := load('sig')
cache := load('cache')

sign := sig.sign

` global request cache, re: Twitter's API rate limit `
CacheGet := (cache.new)()

` TODO: migrate these early on to the v2 APIs which include conversation data
	and metrics, both of which we want for Lucerne.

	NOTE: the home_timeline and status update APIs do not yet have v2 replacements. `

` send a tweet. Will log an error if status is too long. `
send := status => (
	request := {
		method: 'POST'
		url: 'https://api.twitter.com/1.1/statuses/update.json'
	}

	params := {
		status: status
	}

	req(sign(request, params), evt => evt.type :: {
		'resp' -> log(evt.data)
		'error' -> log(evt.message)
	})
)

` retrieves a timeline for a user `
retrieveUser := screenName => (
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
		request.url + string(params)
		cb => req(sign(request, params), evt => evt.type :: {
			'resp' -> cb(evt.data.body)
			'error' -> log(evt.message)
		})
		data => log(data)
	)
)

` retrieve the timeline for the logged-in user `
retrieve := () => (
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
		request.url + string(params)
		cb => req(sign(request, params), evt => evt.type :: {
			'resp' -> cb(evt.data.body)
			'error' -> log(evt.message)
		})
		data => log(data)
	)
)

search := query => (
	request := {
		method: 'GET'
		url: 'https://api.twitter.com/2/tweets/search/recent'
	}

	params := {
		'max_results': '100'
		'query': query
	}

	CacheGet(
		request.url + string(params)
		cb => req(sign(request, params), evt => evt.type :: {
			'resp' -> cb(evt.data.body)
			'error' -> log(evt.message)
		})
		data => log(data)
	)
)

`` search('from:thesephist')
`` retrieveUser('thesephist')
`` retrieve()
