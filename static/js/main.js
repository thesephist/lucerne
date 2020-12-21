const {
    Record,
    StoreOf,
    Component,
    ListOf,
} = Torus;

function fmtPercent(n) {
    return Math.round(n * 100 * 100) / 100 + '%';
}

function trimToMaxLength(s, max) {
    if (s.length <= max) return s;

    return s.substr(0, max) + '...';
}

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

// Global singleton to manage keyboard shortcuts
class ShortcutDispatcher {
    constructor() {
        this.shortcuts = {};

        document.addEventListener('keydown', evt => {
            if (['input', 'textarea'].includes(evt.target.tagName.toLowerCase())) {
                return;
            }

            const fns = this.shortcuts[evt.key];
            if (fns != null) {
                evt.preventDefault();
                for (const fn of fns) {
                    fn(evt);
                }
            }
        });
    }
    addHandlerForKey(key, fn) {
        this.shortcuts[key] = this.shortcuts[key] || [];
        this.shortcuts[key].push(fn);
    }
    addHandler(keys, fn) {
        if (Array.isArray(keys)) {
            for (const key of keys) this.addHandlerForKey(key, fn);
        } else {
            this.addHandlerForKey(keys, fn);
        }
    }
}

class Modal extends Component {
    init(title, children) {
        this.title = title;
        this.children = children;

        this.closer = () => document.body.removeChild(this.node);

        this.render(); // defines this.node
        document.body.appendChild(this.node);
    }
    compose() {
        return jdom`<div class="modalWrapper" onclick="${evt => {
            if (evt.target === this.node) {
                this.closer();
            }
        }}">
            <div class="bordered modal">
                <div class="solid modalTitle">
                    <div class="modalName">${this.title}</div>
                    <button class="solid modalClose" onclick="${this.closer}">close</button>
                </div>
                <div class="modalBody">
                    ${this.children}
                </div>
            </div>
        </div>`;
    }
}

class State extends Record {
    setActiveChannel(chan) {
        this.update({
            query: '',
            channel: chan,
        });
    }
}

class Channel extends Record {}

class ChannelStore extends StoreOf(Channel) {
    fetch() {
        return fetch('/channels').then(resp => {
            if (resp.status !== 200) {
                alert(`Could not load channels: error ${resp.status}`);
                return;
            }

            return resp.json();
        }).then(json => {
            this.reset(json.map(ch => new Channel(ch)));
        }).catch(err => {
            alert(`Could not load channels: ${err}`);
        });
    }
    save() {
        return fetch('/channels', {
            method: 'PUT',
            body: JSON.stringify(this.serialize()),
        }).then(resp => {
            if (resp.status !== 200) {
                alert(`Could not save channels: error ${resp.status}`);
            }
        }).catch(err => {
            alert(`Could not save channels: ${err}`);
        });
    }
}

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

        const openModal = url => {
            new Modal('Tweet media', jdom`<img class="tweetImgPreview" src="${url}" />`);
        }

        return media.map(m => {
            switch (m.type) {
                case 'photo':
                case 'animated_gif': {
                    return jdom`<img load="lazy"
                        class="bordered tweetImg"
                        onclick="${() => openModal(m.media_url_https)}"
                        src="${m.media_url_https}" />`;
                }
                case 'video': {
                    // TODO: link to actual video
                    return jdom`<img load="lazy"
                        class="bordered tweetImg"
                        onclick="${() => openModal(m.media_url_https)}"
                        src="${m.media_url_https}" />`;
                }
                default:
                    console.error(`Unrecognized media type: ${m.type}`);
                    return null;
            }
        });
    }
}

class TweetStore extends StoreOf(Record) {}

class ChannelItem extends Component {
    init(record, remover, {actives}, {getShortcutNumber, saveChannels}) {
        this._editing = false;
        this._input = null;

        this.remover = remover;
        this.getShortcutNumber = getShortcutNumber;
        this.saveChannels = saveChannels;
        this.isActive = () => actives.get('channel') === record;
        this.setActive = () => {
            if (this._editing) return;
            actives.setActiveChannel(record);
        }
        actives.addHandler(() => this.render(record.summarize()));

        this.bind(record, data => this.render(data));

        dispatcher.addHandler(['Backspace', 'Delete'], () => {
            if (this.isActive()) {
                if (confirm(`Delete ${record.get('name')}?`)) {
                    this.remover();
                }
            }
        });
    }
    compose(props) {
        if (this._editing) {
            const stopEditing = () => {
                this._editing = false;
                this._input = '';
                this.render();
            }
            const persist  = () => {
                this.record.update({
                    name: this._input,
                });
                this.saveChannels();
                stopEditing();
            }
            return jdom`<div class="channelItem editing ${this.isActive() ? 'solid ' : ''}">
                <div class="channelName channelInput">
                    <input type="text" value="${this._input}"
                        class="bordered"
                        oninput="${evt => this._input = evt.target.value}"
                        onkeydown="${evt => {
                            switch (evt.key) {
                                case 'Enter': {
                                    persist();
                                    break;
                                }
                                case 'Escape': {
                                    stopEditing();
                                    break;
                                }
                            }
                        }}"/>
                    <button class="channelSave channelButton"
                        onclick="${persist}">save</button>
                </div>
            </div>;`
        }

        return jdom`<div class="channelItem ${this.isActive() ? 'solid' : ''}"
            onclick="${this.setActive}">
            <div class="channelButtons" onclick="${evt => evt.stopPropagation()}">
                <button class="channelButton" onclick="${this.remover}">del</button>
                <button class="channelButton" onclick="${evt => {
                    this._editing = true;
                    this._input = props.name;
                    this.render();
                    this.node.querySelector('input').focus();
                }}">edit</button>
                <button class="channelButton">↑</button>
                <button class="channelButton">↓</button>
            </div>
            <div class="shortcutNumber">
                ${this.getShortcutNumber(this.record)}
            </div>
            <div class="channelName">
                ${props.name}
            </div>
        </div>`;
    }
}

class ChannelList extends ListOf(ChannelItem) {
    init(...args) {
        this.query = '';
        super.init(...args, {
            getShortcutNumber: chan => {
                const index = this.record.summarize().indexOf(chan);
                const number = index + 1;
                if (number <= 10) {
                    return number.toString();
                } else {
                    return '';
                }
            },
            saveChannels: () => this.record.save(),
        });

        const {actives} = args[1];
        actives.addHandler(() => {
            this.query = actives.get('query');
            this.render();
        });
        this.createFromQuery = () => {
            if (!this.query.trim()) return;

            const chan = this.record.create({
                name: this.query,
                query: this.query,
            });
            actives.setActiveChannel(chan);
        }

        dispatcher.addHandler(['1', '2', '3', '4', '5', '6', '7', '8', '9'], evt => {
            const selected = this.record.summarize()[+evt.key - 1]; // 1-index
            if (selected) {
                actives.setActiveChannel(selected);
            }
        });
        dispatcher.addHandler('0', evt => {
            const selected = this.record.summarize()[10 - 1];
            if (selected) {
                actives.setActive(selected);
            }
        });
        dispatcher.addHandler(['+', '='], evt => {
            this.createFromQuery();
        });
    }
    compose() {
        return jdom`<div class="channelList">
            ${this.nodes}
            ${this.query ? jdom`<div class="pseudoChannel channelItem" onclick="${this.createFromQuery}">
                <div class="shortcutNumber">
                    +
                </div>
                <div class="channelName">
                    ${this.query}
                </div>
            </div>` : null}
        </div>`;
    }
}

class MetricTweet extends Record {
    date() {
        return new Date(this.get('created_at'));
    }
    relativeDate() {
        return fmtDate(this.date());
    }
    text() {
        let original = this.get('text');
        const replacements = [];

        const {
            hashtags = [],
            urls = [],
            mentions = [],
        } = this.get('entities') || {};
        for (const hashtag of hashtags) {
            const {text, start, end} = hashtag;
            replacements.push({
                entity: jdom`<a href="${text}">#${text}</a>`,
                start, end,
            });
        }
        for (const url of urls) {
            const {expanded_url, start, end} = url;
            replacements.push({
                entity: jdom`<a href="${expanded_url}">${cleanUpURL(expanded_url)}</a>`,
                start, end,
            });
        }
        for (const mention of mentions) {
            const {screen_name, start, end} = mention;
            replacements.push({
                entity: jdom`<a href="${screen_name}">@${screen_name}</a>`,
                start, end,
            });
        }

        replacements.sort((a, b) => {
            return a.start - b.start;
        });
        let lastIdx = 0;
        let front = [];
        for (const {entity, start, end} of replacements) {
            if (start < lastIdx) continue;

            front.push(decodeHTML(original.substring(lastIdx, start)));
            front.push(entity);
            lastIdx = end;
        }
        front.push(decodeHTML(original.substring(lastIdx, original.length)));

        return front.filter(e => !!e);
    }
}

class MetricTweets extends StoreOf(MetricTweet) {
    fetch() {
        fetch('/trends')
            .then(resp => {
                if (resp.status === 200) {
                    return resp.json();
                }
                return null;
            })
            .then(json => this.reset(json.data.map(mt => new MetricTweet(mt))))
            .catch(err => console.error(err));
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

            return jdom`<div class="tweetItem ${retweeted.get('user').following ? '' : 'notFollowing'}">
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
                        <div class="tweetMedia">${retweeted.media()}</div>
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

        return jdom`<div class="tweetItem ${props.user.following ? '' : 'notFollowing'}">
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
        // TODO: add options:
        // - hide notFollowing tweets
        // - hide retweets
        // - hide image tweets
        // TODO: option to refresh feed / force-refresh feed
        this.tweetList = new TweetList(tweets);
    }
    compose() {
        return jdom`<div class="bordered timeline">
            ${this.tweetList.node}
        </div>`;
    }
}

class TweetTrend extends Component {
    init(record) {
        this.bind(record, data => this.render(data));
    }
    compose(props) {
        const {
            public_metrics: publicm,
            non_public_metrics: privatem,
        } = props;
        return jdom`<div class="tweetTrend">
            <div class="trendMain">
                <div class="tweetTrendText">
                    ${this.record.text()}
                </div>
                <div class="publicMetrics">
                    <div class="metricRow">
                        <strong>${publicm.reply_count}</strong> re
                    </div>
                    <div class="metricRow">
                        <strong>${publicm.quote_count + publicm.retweet_count}</strong> rt/q
                    </div>
                    <div class="metricRow">
                        <strong>${publicm.like_count}
                        (${fmtPercent(publicm.like_count / privatem.impression_count)})</strong>
                        fav
                    </div>
                </div>
            </div>
            <div class="organicMetrics">
                <div class="metricRow">
                    <div class="metricNum">${privatem.user_profile_clicks}</div>
                    <div class="metricName">profile clicks</div>
                </div>
                <div class="metricRow">
                    <div class="metricNum">${privatem.impression_count}</div>
                    <div class="metricName">impressions</div>
                </div>
                ${privatem.url_link_clicks ? jdom`<div class="metricRow">
                    <div class="metricNum">
                        ${privatem.url_link_clicks}
                        (${fmtPercent(privatem.url_link_clicks / privatem.impression_count)})
                    </div>
                    <div class="metricName">link clicks</div>
                </div>` : null}
            </div>
        </div>`;
    }
}

class TweetTrendList extends ListOf(TweetTrend) {
    compose() {
        return jdom`<div class="tweetTrendList">
            ${this.nodes}
        </div>`;
    }
}

class Trends extends Component {
    init() {
        this.metrics = new MetricTweets();
        this.list = new TweetTrendList(this.metrics);

        this.metrics.fetch();
    }
    compose() {
        return jdom`<div class="trends">
            <div class="trendsTitle">trends</div>
            ${this.list.node}
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
    init({actives}) {
        this.input = '';
        this.actives = actives;

        dispatcher.addHandler('/', evt => {
            this.node.querySelector('.queryBar-input').focus();
        });

        this.bind(actives, props => {
            // When the active channel changes, sync the channel's query
            // with the query displayed in the QueryBar.
            this.input = props.query || props.channel.get('query');
            this.render();
        });
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
                value="${this.input}"
                oninput="${evt => this.input = evt.target.value}"
                onkeydown="${evt => {
                    switch (evt.key) {
                        case 'Enter': {
                            this.actives.update({
                                query: this.input.trim(),
                            });
                            break;
                        }
                        case 'Escape': {
                            document.activeElement.blur();
                            break;
                        }
                    }
                }}"/>
            <button class="solid queryBar-button"
                onclick="${evt => {
                    this.actives.update({
                        query: this.input.trim(),
                    });
                }}">-></button>
            <div class="bordered helper">
                <div class="syntaxLine">
                    <div class="syntaxHint"><strong>from</strong>:user</div>
                    <div class="syntaxAction">tweets by @user</div>
                </div>
                <div class="syntaxLine"><div
                    class="syntaxHint"><strong>to</strong>:user</div>
                    <div class="syntaxAction">tweets in reply to @user</div>
                </div>
                <div class="syntaxLine"><div
                    class="syntaxHint"><strong>url</strong>:uri</div>
                    <div class="syntaxAction">tweets with link containing "uri"</div>
                </div>
                <div class="syntaxLine"><div
                    class="syntaxHint"><strong>filter</strong>:{media, retweets, links, images}</div>
                    <div class="syntaxAction">filter by type</div>
                </div>
                <div class="syntaxLine"><div
                    class="syntaxHint"><strong>since</strong>:YYYY-MM-DD, <strong>until</strong>:YYYY-MM-DD</div>
                    <div class="syntaxAction">tweets since, tweets, until</div>
                </div>
                <hr/>
                <div class="syntaxLine"><div
                    class="syntaxHint">-A</div>
                    <div class="syntaxAction"><strong>not</strong> A e.g. -is:retweet</div>
                </div>
                <div class="syntaxLine"><div
                    class="syntaxHint">A B</div>
                    <div class="syntaxAction">A <strong>and</strong> B</div>
                </div>
                <div class="syntaxLine"><div
                    class="syntaxHint">A <strong>OR</strong> B</div>
                    <div class="syntaxAction">A <strong>or</strong> B</div>
                </div>
                <div class="syntaxLine"><div
                    class="syntaxHint">"A B C"</div>
                    <div class="syntaxAction">Literal match "A B C"</div>
                </div>
                <div class="syntaxLine">
                    <div class="syntaxHint">Parentheses group, <strong>AND</strong> precedes <strong>OR</strong></div>
                </div>
            </div>
            <div class="queryBar-shade"></div>
        </div>`;
    }
}

class App extends Component {
    init() {
        this.actives = new State({
            query: '',
            channel: new Channel({
                name: 'home',
                query: 'home_timeline',
            }),
        });
        this.channels = new ChannelStore([
            this.actives.get('channel'),
        ]);
        this.tweets = new TweetStore();

        this.queryBar = new QueryBar({
            actives: this.actives,
        });
        this.sidebar = new Sidebar(this.channels, {
            actives: this.actives,
        });
        this.timeline = new Timeline(this.tweets);
        this.stats = new Stats();

        this.actives.addHandler(() => this.fetchTimeline());
        this.channels.fetch().then(() => {
            this.actives.setActiveChannel(this.channels.summarize()[0]);
        });
        this.channels.addHandler(() => this.channels.save());
    }
    fetchTimeline() {
        const actives = this.actives.summarize();

        // if query is non-blank, create a temp channel for the query
        const channel = actives.query ? new Channel({
            name: actives.query,
            query: actives.query,
        }) : actives.channel;

        if (this._fetchedQuery === channel.get('query')) return;
        this._fetchedQuery = channel.get('query');

        this.tweets.reset([]);
        switch (channel.get('query')) {
            case 'home_timeline': {
                return fetch('/timeline')
                    .then(resp => resp.json())
                    .then(data => this.tweets.reset(data.map(tweet => new Tweet(tweet))));
            }
            default: {
                return fetch(`/search?query=${encodeURIComponent(channel.get('query'))}`)
                    .then(resp => resp.json())
                    .then(data => this.tweets.reset(data.statuses.map(tweet => new Tweet(tweet))));
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

const dispatcher = new ShortcutDispatcher();
const app = new App();
document.getElementById('root').appendChild(app.node);

