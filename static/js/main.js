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

function decodeHTML(text) {
    const ta = document.createElement('textarea');
    ta.innerHTML = text;
    return ta.value;
}

function cleanUpURL(url) {
    return decodeURI(url).replace(/https?:\/\//, '');
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
    text() {
        let original = this.get('full_text');
        const replacements = [];

        const {hashtags, urls, user_mentions} = this.get('entities');
        for (const hashtag of hashtags) {
            const {text, indices} = hashtag;
            replacements.push({
                entity: jdom`<a href="${text}">#${text}</a>`,
                indices,
            });
        }
        for (const url of urls) {
            const {expanded_url, indices} = url;
            replacements.push({
                entity: jdom`<a href="${expanded_url}">${cleanUpURL(expanded_url)}</a>`,
                indices,
            });
        }
        for (const mention of user_mentions) {
            const {screen_name, indices} = mention;
            replacements.push({
                entity: jdom`<a href="${screen_name}">@${screen_name}</a>`,
                indices,
            });
        }
        if (this.get('extended_entities')) {
            const {media} = this.get('extended_entities');
            for (const md of media) {
                const {indices} = md;
                replacements.push({
                    entity: null,
                    indices,
                });
            }
        }

        replacements.sort((a, b) => {
            const ai = a.indices[0];
            const bi = b.indices[0];
            return ai - bi;
        });
        let lastIdx = 0;
        let front = [];
        for (const {entity, indices} of replacements) {
            const [start, end] = indices;
            if (start < lastIdx) continue;

            front.push(decodeHTML(original.substring(lastIdx, start)));
            front.push(entity);
            lastIdx = end;
        }
        front.push(decodeHTML(original.substring(lastIdx, original.length)));

        return front.filter(e => !!e);
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
    init(record, remover, {actives}) {
        this.isActive = () => actives.get('channel') === record;
        this.setActive = () => actives.update({
            channel: record,
        });
        actives.addHandler(() => this.render(record.summarize()));

        this.bind(record, data => this.render(data));
    }
    compose(props) {
        return jdom`<div class="channelItem ${this.isActive() ? 'solid' : ''}"
            onclick="${this.setActive}">
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
    init(channels, props) {
        this.channelList = new ChannelList(channels, props);
    }
    compose() {
        return jdom`<div class="sidebar">
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
            ...this.record.text(),
            jdom`<div class="tweetMedia">${this.record.media()}</div>`,
        ];
        let tweetBody = jdom`<div class="tweetBody">
            <strong>${props.user.screen_name}</strong>
            ${tweetText}
        </div>`;

        if (this.record.isRetweet()) {
            const retweeted = new Tweet(this.record.get('retweeted_status'));
            const props = retweeted.summarize();

            return jdom`<div class="tweetItem">
                <div class="tweetMeta">
                    ${retweeted.relativeDate()}
                    <br />
                    ${props.in_reply_to_status_id ? '↑' : ''}
                </div>
                <div class="tweetMain">
                    <div class="tweetBody">
                        <strong>${this.record.get('user').screen_name}</strong>
                        →
                        <strong>${props.user.screen_name}</strong>
                        ${retweeted.text()}
                    </div>
                    <div class="tweetStats">
                        ${props.retweet_count} rt
                        ·
                        ${props.favorite_count} fav
                    </div>
                </div>
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
                    ${props.retweet_count} rt
                    ·
                    ${props.favorite_count} fav
                </div>
            </div>
        </div>`;
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

class Trends extends Component {
    compose() {
        return jdom`<div class="trends">
            <div class="trendsTitle">trends</div>
        </div>`;
    }
}

class Fans extends Component {
    compose() {
        return jdom`<div class="fans">
            <div class="fansTitle">fans</div>
        </div>`;
    }
}

class Stats extends Component {
    init() {
        this.trends = new Trends();
        this.fans = new Fans();
    }
    compose() {
        return jdom`<div class="stats">
            ${this.trends.node}
            ${this.fans.node}
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
        this.actives = new Record({
            channel: new Channel({
                name: 'home',
                query: 'home_timeline',
            }),
        });
        this.channels = new ChannelStore([
            this.actives.get('channel'),
            new Channel({
                name: 'thesephist.com',
                query: 'url:"https://thesephist.com"'
            }),
        ]);
        this.tweets = new TweetStore();

        this.queryBar = new QueryBar();
        this.sidebar = new Sidebar(this.channels, {
            actives: this.actives,
        });
        this.timeline = new Timeline(this.tweets);
        this.stats = new Stats();

        this.actives.addHandler(() => this.fetchTimeline());
    }
    fetchTimeline() {
        const channel = this.actives.get('channel');
        if (this._fetchedChannel === channel) return;
        this._fetchedChannel = channel;

        this.tweets.reset([]);
        switch (channel.get('query')) {
            case 'home_timeline': {
                return fetch('/timeline')
                    .then(resp => resp.json())
                    .then(data => this.tweets.reset(data.map(tweet => new Tweet(tweet))));
            }
            default: {
                return fetch(`/search?query=${channel.get('query')}`)
                    .then(resp => resp.json())
                    .then(data => this.tweets.reset(data.data.map(tweet => new Tweet(tweet))));
            }
        }
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

