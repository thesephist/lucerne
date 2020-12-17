` tweet.ink, program to send tweets `

` standard libraries `
std := load('vendor/std')
json := load('vendor/json')

each := std.each
deJSON := json.de

` hmac-sha1 signing `
hmac := load('lib/hmac')
sig := load('lib/sig')
cache := load('lib/cache')

log := std.log
sign := sig.sign

` global request cache, re: Twitter's API rate limit `
CacheGet := (cache.new)()

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

` retrieve the timeline for the logged-in user `
retrieve := () => (
	request := {
		method: 'GET'
		url: 'https://api.twitter.com/1.1/statuses/home_timeline.json'
	}

	params := {
		` acccommodate tweets >140 characters `
		'tweet_mode': 'extended'
	}

	CacheGet(
		request.url
		cb => req(sign(request, params), evt => evt.type :: {
			'resp' -> cb(evt.data.body)
			'error' -> log(evt.message)
		})
		data => log(data)
	)
)

`` TEST
`` send('Tweet sent with Ink, ' + string(floor(time())))
`` retrieve()

`` readFile := std.readFile
`` readFile('./home_timeline.json', file => file :: {
`` 	() -> log('error reading file')
`` 	_ -> (
`` 		tweets := deJSON(file)
`` 		log(len(tweets))
`` 		each(tweets, tweet => (
`` 			log(tweet.user.'screen_name')
`` 			log(tweet.'full_text')
`` 		))
`` 	)
`` })
