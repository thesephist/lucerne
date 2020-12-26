` HTTP request cache `

std := load('../vendor/std')

log := std.log
f := std.format
reduce := std.reduce

MaxCached := 100
CacheDelay := 60 `` seconds. Tw API rate limits are max 15req/15min.
CacheDelay := 300 `` 5 mins, DEBUG

new := () => (
	store := {}

	getTimestamp := key => store.(key) :: {
		() -> 0
		_ -> store.(key).timestamp
	}

	` get the oldest valid record in the cache to evict with LRU policy `
	oldest := () => reduce(keys(store), (acc, key) => getTimestamp(key) < getTimestamp(acc) :: {
		true -> key
		false -> acc
	}, keys(store).0)

	` cache.new returns a single callback that is the "getter" for the cache.

		key: the key on which the value is cached
		fetch: an async function to fetch the new value, should that be needed
		cb: callback to be invoked by the cache with the cached or new value `
	get := (key, fetch, cb) => time() - getTimestamp(key) < CacheDelay :: {
		true -> cb(store.(key).record)
		_ -> fetch(resp => (
			log(f('Cache invalidated, fetched {{0}}', [key]))
			store.(key) := {
				timestamp: time()
				record: resp
			}
			len(store) > MaxCached :: {
				true -> (
					evicted := oldest()
					store.(evicted) := () `` clear cache
					log(f('Cache limit exceeded, evicting {{0}}', [evicted]))
				)
			}
			cb(resp)
		))
	}
)

