const {
	Record,
	StoreOf,
	Component,
	ListOf,
} = Torus;

function fmtDate(date) {
	const delta = (Date.now() - date) / 1000;
	if (delta < 60) {
		return `${~~delta}s`;
	} else if (delta < 3600) {
		return `${~~(delta / 60)}m`;
	} else if (delta < 86400) {
		return `${~~(delta / 3600)}h`;
	} else if (delta < 86400 * 30) {
		return `${~~(delta / 86400)}d`;
	} else if (delta < 86400 * 365) {
		return `${~~(delta / 86400 * 30)}mo`;
	} else {
		return `${~~(delta / 86400 * 365)}y`;
	}
}

class Channel extends Record {}

class ChannelStore extends StoreOf(Channel) {}

class Tweet extends Record {
	date() {
		return new Date(this.get('created_at'));
	}
	relativeDate() {
		return fmtDate(this.date());
	}
	isRetweet() {
		return this.get('retweeted_status') && !this.isQuote();
	}
	isQuote() {
		return this.get('is_quote_status') && !!this.get('quoted_status');
	}
	media() {
		const entities = this.get('extended_entities');
		if (!entities) return [];
		const media = entities.media;
		if (!media) return [];

		return media.map(m => jdom`<img load="lazy"
			class="bordered tweetImg"
			src="${m.media_url_https}" />`);
	}
}

class TweetStore extends StoreOf(Record) {}

class ChannelItem extends Component {
	init(record) {
		this.bind(record, data => this.render(data));
	}
	compose(props) {
		return jdom`<div class="channelItem">
			${props.name}
		</div>`;
	}
}

class ChannelList extends ListOf(ChannelItem) {
	compose() {
		return jdom`<div class="channelList">
			${this.nodes}
		</div>`;
	}
}

class Sidebar extends Component {
	init(channels) {
		this.channelList = new ChannelList(channels)
	}
	compose() {
		return jdom`<div class="sidebar">
			Sidebar
			${this.channelList.node}
		</div>`;
	}
}

class TweetItem extends Component {
	init(record) {
		this.bind(record, data => this.render(data));
	}
	compose(props) {
		const tweetText = [
			// TODO: expand extended entities into full_text
			props.full_text,
			jdom`<div class="tweetMedia">${this.record.media()}</div>`,
		];
		let tweetBody = jdom`<div class="tweetBody">
			<strong>${props.user.screen_name}</strong>
			${tweetText}
		</div>`;
		if (this.record.isRetweet()) {
			tweetBody = jdom`<div class="tweetBody">
				<strong>${props.user.screen_name}</strong>
				→
				<strong>${props.retweeted_status.user.screen_name}</strong>
				${new TweetItem(new Tweet(props.retweeted_status)).node}
			</div>`;
		} else if (this.record.isQuote()) {
			tweetBody = jdom`<div class="tweetBody">
				<strong>${props.user.screen_name}</strong>
				${tweetText}
				${new TweetItem(new Tweet(props.quoted_status)).node}
			</div>`;
		}

		return jdom`<div class="tweetItem">
			<div class="tweetMeta">
				${this.record.relativeDate()}
				<br />
				${props.in_reply_to_status_id ? '↑' : ''}
			</div>
			<div class="tweetMain">
				${tweetBody}
				<div class="tweetStats">
					0 re
					·
					${props.retweet_count} rt
					·
					${props.favorite_count} fav
				</div>
			</div>
		</div>`
	}
}

class TweetList extends ListOf(TweetItem) {
	compose() {
		return jdom`<div class="tweetList">
			${this.nodes}
		</div>`;
	}
}

class Timeline extends Component {
	init(tweets) {
		this.tweetList = new TweetList(tweets);
	}
	compose() {
		return jdom`<div class="bordered timeline">
			${this.tweetList.node}
		</div>`;
	}
}

class Stats extends Component {
	compose() {
		return jdom`<div class="stats">
			stats
		</div>`;
	}
}

class QueryBar extends Component {
	init() {
		this.query = '';
	}
	compose() {
		return jdom`<div class="queryBar">
			<a class="solid queryBar-logo" href="/">
				<span class="desktop">lucerne.</span>
				<span class="mobile">lc.</span>
			</a>
			<input class="bordered queryBar-input"
				type="text"
				placeholder="has: by: since: until:"
				value="${this.query}" />
			<button class="solid queryBar-button">→</button>
		</div>`;
	}
}

class App extends Component {
	init() {
		this.channels = new ChannelStore([
			new Channel({
				name: 'home',
				query: 'home',
			}),
			new Channel({
				name: 'thesephist.com',
				query: 'has:thesephist.com'
			}),
		]);
		this.tweets = new TweetStore();

		this.queryBar = new QueryBar();
		this.sidebar = new Sidebar(this.channels);
		this.timeline = new Timeline(this.tweets);
		this.stats = new Stats();

		fetch('/timeline')
			.then(resp => resp.json())
			.then(data => this.tweets.reset(data.map(tweet => new Tweet(tweet))));
	}
	compose() {
		return jdom`<div class="app">
			${this.queryBar.node}
			<div class="sections">
				${this.sidebar.node}
				${this.timeline.node}
				${this.stats.node}
			</div>
		</div>`;
	}
}

const app = new App();
document.getElementById('root').appendChild(app.node);


