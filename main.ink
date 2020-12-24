` Lucerne, a twitter client `

std := load('vendor/std')
str := load('vendor/str')
json := load('vendor/json')

log := std.log
f := std.format
deJSON := json.de
readFile := std.readFile
writeFile := std.writeFile

http := load('vendor/http')
mime := load('vendor/mime')
percent := load('vendor/percent')

mimeForPath := mime.forPath
pctDecode := percent.decode

twitter := load('lib/twitter')

retrieve := twitter.retrieve
search := twitter.search
conversation := twitter.conversation
trends := twitter.trends

server := (http.new)()
MethodNotAllowed := {status: 405, body: 'method not allowed'}

serveStatic := path => (req, end) => req.method :: {
	'GET' -> readFile('static/' + path, file => file :: {
		() -> end({status: 404, body: 'file not found'})
		_ -> end({
			status: 200
			headers: {'Content-Type': mimeForPath(path)}
			body: file
		})
	})
	_ -> end(MethodNotAllowed)
}

addRoute := server.addRoute

` Twitter API wrappers `
addGetAPI := (url, provider) => addRoute(url, params => (req, end) => req.method :: {
	'GET' -> provider(params, data => end({
		status: data :: {() -> 500, _ -> 200}
		headers: {'Content-Type': 'application/json'}
		body: data :: {
			() -> '{"error": "failed to fetch"}'
			_ -> data
		}
	}))
	_ -> end(MethodNotAllowed)
})
addGetAPI('/timeline', (params, cb) => retrieve(params.max, cb))
addGetAPI('/search', (params, cb) => search(params.query, params.max, cb))
addGetAPI('/conversation/*tweetID', (params, cb) => conversation(params.tweetID, params.max, cb))
addGetAPI('/trends', (_, cb) => trends(cb))

` Local data services `
addRoute('/channels', params => (req, end) => req.method :: {
	'GET' -> readFile('./db/channels.json', file => file :: {
		() -> end({
			status: 404
			body: 'data not found'
		})
		_ -> end({
			status: 200
			headers: {'Content-Type': 'application/json'}
			body: file
		})
	})
	'PUT' -> writeFile('./db/channels.json', req.body, res => res :: {
		true -> end({
			status: 200
			body: ''
		})
		_ -> end({
			status: 500
			body: 'could not save data'
		})
	})
	_ -> end(MethodNotAllowed)
})

addRoute('/static/*staticPath', params => serveStatic(params.staticPath))
addRoute('/', params => serveStatic('index.html'))

start := () => (
	end := (server.start)(7238)
	log(f('Lucerne started, listening on 0.0.0.0:{{0}}', [7283]))
)

` if database directory not created, create one `
DefaultChannels := '[{"name": "home", "query": "home_timeline"}]'
dir('./db', evt => evt.type :: {
	'error' -> make('./db', evt => evt.type :: {
		'end' -> writeFile('./db/channels.json', DefaultChannels, res => res :: {
			true -> start()
			_ -> log('Could not create channels database.')
		})
		_ -> log('Could not create database directory.')
	})
	'data' -> start()
})

