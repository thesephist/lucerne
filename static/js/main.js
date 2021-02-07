const {
    Record,
    StoreOf,
    Component,
    ListOf,
    Router,
} = Torus;

const ME = 'thesephist';
const HOME_QUERY = 'home_timeline';

function fmtPercent(n) {
    return Math.round(n * 100 * 100) / 100 + '%';
}

function fmtNumber(n) {
    let s = '';
    while (n > 1000) {
        const front = 1000 * Math.floor(n / 1000);
        const back = n - front;
        s = back.toString().padStart(3, '0') + ',' + s;
        n = front / 1000;
    }
    s = (n + ',' + s);
    return s.substr(s, s.length - 1);
}

function trimToMaxLength(s, max) {
    if (s.length <= max) return s;

    return s.substr(0, max) + '...';
}

function substringByCodePoint(s, start, end) {
    return [...s].slice(start, end).join('');
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
        return `${~~(delta / 86400 / 30)}mo`;
    } else {
        return `${~~(delta / 86400 / 365)}y`;
    }
}

function stitchEntities(original, replacements) {
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

        front.push(decodeHTML(substringByCodePoint(original, lastIdx, start)));
        front.push(entity);
        lastIdx = end;
    }
    front.push(decodeHTML(substringByCodePoint(original, lastIdx, original.length)));

    return front.filter(e => !!e);
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
            if (evt.ctrlKey || evt.metaKey) return;
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

        this.remove = this.remove.bind(this);

        this.handleEscape = evt => {
            if (evt.key !== 'Escape') return;

            this.remove();
        }
        document.body.addEventListener('keydown', this.handleEscape);

        this.render(); // defines this.node
        document.body.appendChild(this.node);
    }
    remove() {
        document.body.removeChild(this.node);
        document.body.removeEventListener('keydown', this.handleEscape);

        super.remove();
    }
    compose() {
        return jdom`<div class="modalWrapper" onclick="${evt => {
            if (evt.target === this.node) {
                this.remove();
            }
        }}">
            <div class="bordered modal">
                <div class="solid modalTitle">
                    <div class="modalName">${this.title}</div>
                    <button class="solid modalClose" onclick="${this.remove}">close</button>
                </div>
                <div class="modalBody">
                    ${typeof this.children === 'function' ? this.children(this.remove) : this.children}
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
    // returns the currently active query as a Channel abstraction, regardless
    // of whether the active query is from a pre-set channel or a custom ad-hoc
    // query. This is useful becaue the Channel abstraction provides lots of
    // nice methods for interacting with filtered streams of tweets.
    effectiveChannel() {
        const actives =this.summarize();

        // if query is non-blank, create a temp channel for the query
        if (actives.query) {
            return new Channel({
                name: actives.query,
                query: actives.query,
            });
        }
        return actives.channel;
    }
}

class Channel extends Record {
    isHome() {
        return this.get('query') === HOME_QUERY;
    }
    fetchTweets({ max } = {}) {
        const params = new URLSearchParams();
        if (max) {
            // max_id / until_id for pagination
            params.set('max', max);
        }

        const query = this.get('query');
        switch (query) {
            case HOME_QUERY: {
                return fetch('/timeline?' + params.toString())
                    .then(resp => resp.json())
                    .then(data => data.map(tweet => new Tweet(tweet)));
            }
        }
        // default: fallthrough

        const REPLY_RE = /\bre:(\d+)\b/;
        const CONV_RE = /\bconv:(\d+)\b/;

        const re_match = query.match(REPLY_RE);
        const conv_match = query.match(CONV_RE);

        if (re_match != null) {
            const tid = re_match[1];
            return fetch(`/conversation/${tid}?${params.toString()}`)
                .then(resp => resp.json())
                .then(data => data
                    .filter(tw => tw.in_reply_to_status_id_str === tid || tw.id_str === tid)
                    .map(tweet => new Tweet(tweet)));
        } else if (conv_match != null) {
            const tid = conv_match[1];
            return fetch(`/conversation/${tid}?${params.toString()}`)
                .then(resp => resp.json())
                .then(data => data.map(tweet => new Tweet(tweet)));
        }

        params.set('query', query);
        return fetch(`/search?${params.toString()}`)
            .then(resp => resp.json())
            .then(data => data.statuses.map(tweet => new Tweet(tweet)));
    }
}

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
    reorder(channel, increment) {
        const old = this.summarize();
        if (!old.includes(channel)) return;

        const idx = old.indexOf(channel);
        if (idx + increment < 0) return;
        if (idx + increment >= old.length) return;

        old.splice(idx, 1);
        old.splice(idx + increment, 0, channel);
        this.reset(old);
    }
    save() {
        if (!this.records.size) {
            return Promise.resolve();
        }

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
    constructor(props) {
        super(props.id_str, props);
    }
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
    webClientURL() {
        return `https://twitter.com/${this.get('user').screen_name}/status/${this.id}`;
    }
    text() {
        const replacements = [];

        const {hashtags, urls, user_mentions} = this.get('entities');
        for (const hashtag of hashtags) {
            const {text, indices} = hashtag;
            replacements.push({
                entity: jdom`<a href="#" onclick="${evt => {
                    evt.preventDefault();
                    router.gotoQuery('#' + text);
                }}">#${text}</a>`,
                indices,
            });
        }
        for (const url of urls) {
            const {expanded_url, indices} = url;
            replacements.push({
                entity: jdom`<a href="${expanded_url}" target="_blank">${cleanUpURL(expanded_url)}</a>`,
                indices,
            });
        }
        for (const mention of user_mentions) {
            const {screen_name, indices} = mention;
            replacements.push({
                entity: jdom`<a href="https://twitter.com/${screen_name}" onclick="${evt => {
                    evt.preventDefault();
                    router.gotoQuery('from:' + screen_name);
                }}">@${screen_name}</a>`,
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

        return stitchEntities(this.get('full_text'), replacements);
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
                    return jdom`<div class="tweetImgBox">
                        <img loading="lazy"
                            class="bordered tweetImg"
                            onclick="${() => openModal(m.media_url_https)}"
                            src="${m.media_url_https}" />
                        </div>`;
                }
                case 'video': {
                    return jdom`<div class="tweetVideoBox">
                        <img loading="lazy"
                            class="bordered tweetImg"
                            onclick="${() => openModal(m.media_url_https)}"
                            src="${m.media_url_https}" />
                    </div>`;
                }
                default:
                    console.error(`Unrecognized media type: ${m.type}`);
                    return null;
            }
        });
    }
}

class TweetStore extends StoreOf(Record) {
    get comparator() {
        return tweet => -tweet.date();
    }
    add(record) {
        if (this.find(record.id)) return;
        return super.add(record);
    }
}

class User extends Record {
    webClientURL() {
        return `https://twitter.com/${this.get('username')}`;
    }
    bio() {
        const user = this.summarize();
        const entities = (user.entities || {}).description;
        if (!entities) return user.description;
        const urls = entities.urls;
        if (!urls) return user.description;

        const replacements = [];
        for (const url of urls) {
            const {expanded_url, start, end} = url;
            replacements.push({
                entity: jdom`<a href="${expanded_url}"
                    target="_blank">${cleanUpURL(expanded_url)}</a>`,
                indices: [start, end],
            });
        }

        return stitchEntities(user.description, replacements);
    }
}

class Users extends StoreOf(User) {
    fetch() {
        fetch('/followers')
            .then(resp => {
                if (resp.status === 200) {
                    return resp.json();
                }
                return null;
            })
            .then(json => this.reset(json.data.map(u => new User(u))))
            .catch(err => console.error(err));
    }
}

class ChannelItem extends Component {
    init(record, remover, {actives}, {getShortcutNumber, saveChannels, moveUp, moveDown}) {
        this._editing = false;
        this._input = null;

        this.remover = remover;
        this.getShortcutNumber = getShortcutNumber;
        this.saveChannels = saveChannels;
        this.moveUp = () => moveUp(this.record);
        this.moveDown = () => moveDown(this.record);

        this.isActive = () => actives.get('channel') === record;
        this.setActive = () => {
            if (this._editing) return;
            router.gotoChannel(record);
        }
        this.startEditing = () => {
            this._editing = true;
            this._input = this.record.get('name');
            this.render();
            this.node.querySelector('input').focus();
        }
        actives.addHandler(() => this.render(record.summarize()));

        this.bind(record, data => this.render(data));

        if (!this.record.isHome()) {
            dispatcher.addHandler(['Backspace', 'Delete'], () => {
                if (this.isActive()) {
                    if (confirm(`Delete ${record.get('name')}?`)) {
                        this.remover();
                    }
                }
            });
            dispatcher.addHandler(['[', ']'], () => {
                if (this.isActive()) {
                    this.startEditing();
                }
            });
            dispatcher.addHandler('j', () => {
                if (this.isActive()) {
                    this.moveDown();
                }
            });
            dispatcher.addHandler('k', () => {
                if (this.isActive()) {
                    this.moveUp();
                }
            });
        }
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
                <button class="channelButton" onclick="${this.startEditing}">edit</button>
                <button class="channelButton" onclick="${this.moveUp}">↑</button>
                <button class="channelButton" onclick="${this.moveDown}">↓</button>
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
                    return (number % 10).toString();
                } else if (number <= 20) {
                    return String.fromCodePoint(number + 86 - 32);
                } else {
                    return '';
                }
            },
            saveChannels: () => this.record.save(),
            moveUp: chan => this.record.reorder(chan, -1),
            moveDown: chan => this.record.reorder(chan, 1),
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
            router.gotoChannel(chan);
        }

        dispatcher.addHandler(['1', '2', '3', '4', '5', '6', '7', '8', '9'], evt => {
            const selected = this.record.summarize()[+evt.key - 1]; // 1-index
            if (selected) {
                router.gotoChannel(selected);
            }
        });
        // we can't use j, k here because they're for moving channels in list
        dispatcher.addHandler(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'm'], evt => {
            const selected = this.record.summarize()[evt.key.codePointAt(0) - 87]; // starts at a => 11
            console.log(evt.key.codePointAt(0) - 86);
            if (selected) {
                router.gotoChannel(selected);
            }
        });
        dispatcher.addHandler('0', evt => {
            const selected = this.record.summarize()[10 - 1];
            if (selected) {
                router.gotoChannel(selected);
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
        const replacements = [];

        const {
            hashtags = [],
            urls = [],
            mentions = [],
        } = this.get('entities') || {};
        for (const hashtag of hashtags) {
            const {tag, start, end} = hashtag;
            replacements.push({
                entity: jdom`<a href="${tag}">#${tag}</a>`,
                indices: [start, end],
            });
        }
        for (const url of urls) {
            const {expanded_url, start, end} = url;
            replacements.push({
                entity: jdom`<a href="${expanded_url}">${cleanUpURL(expanded_url)}</a>`,
                indices: [start, end],
            });
        }
        for (const mention of mentions) {
            const {username, start, end} = mention;
            replacements.push({
                entity: jdom`<a href="${username}">@${username}</a>`,
                indices: [start, end],
            });
        }

        return stitchEntities(this.get('text'), replacements);
    }
    rawText() {
        return Torus.render(null, null, jdom`<div>${this.text()}</div>`).textContent;
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
        this._selfMetrics = {
            followers_count: 0,
            following_count: 0,
        };
        this.channelList = new ChannelList(channels, props);

        fetch('/self')
            .then(resp => {
                if (resp.status !== 200) {
                    return;
                }
                return resp.json();
            })
            .then(json => {
                this._selfMetrics = json.data.public_metrics;
                this.render();
            })
            .catch(err => {
                console.error(`Could not load account metrics: ${err}`);
            });
    }
    compose() {
        return jdom`<div class="sidebar">
            ${this.channelList.node}
            <div class="selfMetrics">
                <a href="https://twitter.com/${ME}" target="_blank">@${ME}</a>
                ·
                <strong>${fmtNumber(this._selfMetrics.followers_count)}</strong> 'ers
                ·
                <strong>${fmtNumber(this._selfMetrics.following_count)}</strong> 'ing
            </div>
        </div>`;
    }
}

function UserPopup(user) {
    function userURL(user) {
        const entities = (user.entities || {}).url;
        if (!entities) return user.url;
        const urls = entities.urls;

        const replacements = [];
        for (const url of urls) {
            const {expanded_url, indices} = url;
            replacements.push({
                entity: jdom`<a href="${expanded_url}"
                    target="_blank">${cleanUpURL(expanded_url)}</a>`,
                indices,
            });
        }

        return stitchEntities(user.url, replacements);
    }

    function userBio(user) {
        const entities = (user.entities || {}).description;
        if (!entities) return user.description;
        const urls = entities.urls;
        if (!urls) return user.description;

        const replacements = [];
        for (const url of urls) {
            const {expanded_url, indices} = url;
            replacements.push({
                entity: jdom`<a href="${expanded_url}"
                    target="_blank">${cleanUpURL(expanded_url)}</a>`,
                indices,
            });
        }

        return stitchEntities(user.description, replacements);
    }

    return jdom`<div class="UserPopup bordered">
        <div class="solid userPopupHeader">
            <img class="bordered profileImg"
                src="${user.profile_image_url_https}" alt="Profile picture" />
            <div class="name">
                <a class="nameLink" href="https://twitter.com/${user.screen_name}" target="_blank">
                    ${user.name}
                </a>
            </div>
            <div class="location">
                @${user.screen_name}
                ${user.url ? [
                    '· ',
                    jdom`<span class="userPopupURL">${userURL(user)}</span>`,
                ] : null}
                ${user.location ? `· ${user.location}` : null}
            </div>
        </div>
        <div class="userPopupDescription">
            ${userBio(user)}
        </div>
        <div class="userPopupFilters">
            <button class="userPopupFilter"
                onclick="${() => router.gotoQuery(`from:${user.screen_name} -filter:replies`)}">recents</button>
            ·
            <button class="userPopupFilter"
                onclick="${() => router.gotoQuery(`from:${user.screen_name} -filter:replies min_faves:10`)}">top</button>
            ·
            <button class="userPopupFilter"
                onclick="${() => router.gotoQuery(`(from:${ME} OR @${ME}) (from:${user.screen_name} OR @${user.screen_name})`)}">
                    mutual
            </button>
        </div>
        <div class="userPopupStats">
            <strong>${fmtNumber(user.friends_count)}</strong> following
            ·
            <strong>${fmtNumber(user.followers_count)}</strong> followers
        </div>
    </div>`;
}

class TweetItem extends Component {
    init(record, _, actives) {
        this.actives = actives;
        this.showConversation = tweet => router.gotoQuery(`conv:${tweet.id}`);
        this.showReplies = tweet => router.gotoQuery(`re:${tweet.id}`);
        this.bind(record, data => this.render(data));
    }
    compose(props) {
        const tweetMeta = tweet => {
            return jdom`<div class="tweetMeta">
                <a class="dateLink" href="${tweet.webClientURL()}" target="_blank">
                    ${tweet.relativeDate()}
                </a>
                <br />
                ${tweet.get('in_reply_to_status_id') ? '↑' : ''}
            </div>`
        }
        const tweetText = tweet => {
            return [
                ...tweet.text(),
                jdom`<div class="tweetMedia">${tweet.media()}</div>`,
            ];
        }

        const tweetStats = tweet => {
            const props = tweet.summarize();
            return jdom`<div class="tweetStats">
                <span class="${props.retweeted ? 'selfRetweeted' : ''}">${fmtNumber(props.retweet_count)} rt</span>
                ·
                <span class="${props.favorited ? 'selfFavorited' : ''}">${fmtNumber(props.favorite_count)} fav</div>
                ·
                <button class="tweetConversation" onclick="${() => this.showConversation(tweet)}">conv</button>
                ·
                <button class="tweetConversation" onclick="${() => this.showReplies(tweet)}">replies</button>
            </div>`;
        }

        const mention = user => {
            return jdom`<strong class="tweetUserMention" onclick="${evt => {
                if (evt.target === evt.currentTarget) {
                    router.gotoQuery('from:' + user.screen_name);
                }
            }}">
                ${user.screen_name}
                ${UserPopup(user)}
            </strong>`;
        }

        let tweetBody = jdom`<div class="tweetBody">
            ${mention(props.user)}
            ${tweetText(this.record)}
        </div>`;

        if (this.record.isRetweet()) {
            const retweeted = new Tweet(this.record.get('retweeted_status'));
            const props = retweeted.summarize();

            return jdom`<div class="tweetItem ${retweeted.get('user').following ? '' : 'notFollowing'}">
                ${tweetMeta(retweeted)}
                <div class="tweetMain">
                    <div class="tweetBody">
                        ${mention(this.record.get('user'))}
                        →
                        ${mention(props.user)}
                        ${tweetText(retweeted)}
                    </div>
                    ${tweetStats(retweeted)}
                </div>
            </div>`;
        } else if (this.record.isQuote()) {
            tweetBody = jdom`<div class="tweetBody">
                ${mention(props.user)}
                ${tweetText(this.record)}
                ${new TweetItem(new Tweet(props.quoted_status), null, this.actives).node}
            </div>`;
        }

        return jdom`<div class="tweetItem ${props.user.following ? '' : 'notFollowing'}">
        ${tweetMeta(this.record)}
            <div class="tweetMain">
                ${tweetBody}
                ${tweetStats(this.record)}
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
    init(tweets, actives) {
        this._loadingMore = false;

        this.tweetList = new TweetList(tweets, actives);

        this.loadMore = async minID => {
            this._loadingMore = true
            this.render();

            const channel = actives.effectiveChannel();
            const moreTweets = await channel.fetchTweets({
                max: minID,
            });

            // check again whether user has changed channel/query since fetch in initiated
            if (channel.get('query') != actives.effectiveChannel().get('query')) return;

            for (const tweet of moreTweets) {
                tweets.add(tweet);
            }
            this._loadingMore = false;
            this.render();
        }
    }
    compose() {
        return jdom`<div class="bordered timeline">
            ${this.tweetList.node}
            ${this._loadingMore ? jdom`<div class="timelineLoading thin" />` : jdom`<button class="tweetListLoadMore"
                onclick="${evt => {
                    const tweets = Array.from(this.tweetList.record.records.values())
                    const ids = tweets.map(tw => tw.id);
                    const minID = ids.sort()[0];
                    if (!minID) return;

                    this.loadMore(minID);
                }}">
                more ↓
            </button>`}
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
                <div class="tweetTrendText" title="${this.record.rawText()}">
                    <span class="date">${this.record.relativeDate()}</span>
                    ·
                    ${this.record.text()}
                </div>
                <div class="publicMetrics">
                    <div class="metricRow">
                        <strong>${fmtNumber(publicm.reply_count)}</strong> re
                        ·
                        <strong>${fmtNumber(publicm.quote_count + publicm.retweet_count)}</strong> rt/q
                    </div>
                    <div class="metricRow">
                        <strong>${publicm.like_count}
                        (${fmtPercent(publicm.like_count / privatem.impression_count)})</strong>
                        fav
                    </div>
                </div>
            </div>
            <div class="organicMetrics">
                <div class="metricRow half">
                    <strong>${fmtNumber(privatem.impression_count)}</strong> impressions
                </div>
                <div class="metricRow half">
                    <strong>${fmtNumber(privatem.user_profile_clicks)}</strong> profile clicks
                </div>
                ${privatem.url_link_clicks ? jdom`<div class="metricRow">
                    <strong>
                        ${fmtNumber(privatem.url_link_clicks)}
                        (${fmtPercent(privatem.url_link_clicks / privatem.impression_count)})
                    </strong>
                    link clicks
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

class UserItem extends Component {
    init(record) {
        this.bind(record, data => this.render(data));
    }
    compose(props) {
        return jdom`<div class="UserItem">
            <div class="userItemPicture">
                <img class="bordered" src="${props.profile_image_url}" alt="${props.username}" />
            </div>
            <div class="userItemNames">
                <div class="name">
                    <a href="${this.record.webClientURL()}" target="_blank">
                        ${props.name}
                    </a>
                </div>
                <div class="searches">
                    @${props.username}
                    ·
                    <button class="userItemFilter"
                        onclick="${() => router.gotoQuery(`from:${props.username} -filter:replies`)}">recents</button>
                    ·
                    <button class="userItemFilter"
                        onclick="${() => router.gotoQuery(`from:${props.username} -filter:replies min_faves:10`)}">top</button>
                </div>
                <div class="bio">
                    ${this.record.bio()}
                </div>
            </div>
            <div class="userItemStats">
                <div class="followers">
                    <strong>${fmtNumber(props.public_metrics.followers_count)}</strong>
                    'ers
                </div>
                <div class="following">
                    <strong>${fmtNumber(props.public_metrics.following_count)}</strong>
                    'ing
                </div>
            </div>
        </div>`;
    }
}

class UserList extends ListOf(UserItem) {
    compose() {
        return jdom`<div class="UserList">
            ${this.nodes}
        </div>`;
    }
}

class Fans extends Component {
    init() {
        this.followers = new Users();
        this.list = new UserList(this.followers);

        this.followers.fetch();
    }
    compose() {
        return jdom`<div class="fans">
            <div class="fansTitle">followers</div>
            ${this.list.node}
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
                            router.gotoQuery(this.input.trim());
                            evt.target.blur();
                            break;
                        }
                        case 'Escape': {
                            evt.target.blur();
                            break;
                        }
                    }
                }}"/>
            <button class="mobile bordered sectionOpener queryBar-button"
                onclick="${evt => {
                    new Modal('Sections', closer => jdom`<div class="sectionSelector">
                        <button class="bordered sectionButton" onclick="${evt => {
                            router.go('/chans');
                            closer();
                        }}">channels</button>
                        <button class="bordered sectionButton" onclick="${evt => {
                            router.go('/');
                            closer();
                        }}">timeline</button>
                        <button class="bordered sectionButton" onclick="${evt => {
                            router.go('/stats');
                            closer();
                        }}">stats</button>
                    </div>`);
                }}">
                sec
            </button>
            <button class="solid queryBar-button"
                onclick="${evt => {
                    router.gotoQuery(this.input.trim());
                }}">-></button>
            <div class="bordered helper">
                <div class="syntaxLine">
                    <div class="syntaxHint"><strong>from</strong>:user, <strong>to</strong>:user</div>
                    <div class="syntaxAction">tweets by, in reply to @user</div>
                </div>
                <div class="syntaxLine">
                    <div class="syntaxHint"><strong>url</strong>:uri</div>
                    <div class="syntaxAction">tweets with link containing "uri"</div>
                </div>
                <div class="syntaxLine">
                    <div class="syntaxHint"><strong>re</strong>:id</div>
                    <div class="syntaxAction">replies to given tweet (standalone)</div>
                </div>
                <div class="syntaxLine">
                    <div class="syntaxHint"><strong>conv</strong>:id</div>
                    <div class="syntaxAction">conversations from a given tweet (standalone)</div>
                </div>
                <div class="syntaxLine">
                    <div class="syntaxHint"><strong>sort</strong>:top</div>
                    <div class="syntaxAction">search by popularity, not recency</div>
                </div>
                <div class="syntaxLine">
                    <div class="syntaxHint"><strong>lang</strong>:en, de, ja, es, ko, hi, ...</div>
                    <div class="syntaxAction">tweets in a given language</div>
                </div>
                <div class="syntaxLine">
                    <div class="syntaxHint"><strong>min_faves</strong>:N, <strong>min_retweets</strong>:N</div>
                    <div class="syntaxAction">tweets with N or more likes or retweets</div>
                </div>
                <div class="syntaxLine">
                    <div class="syntaxHint"><strong>filter</strong>:media, retweets, replies, links, images</div>
                    <div class="syntaxAction">filter by type</div>
                </div>
                <div class="syntaxLine">
                    <div class="syntaxHint"><strong>since</strong>:YYYY-MM-DD, <strong>until</strong>:YYYY-MM-DD</div>
                    <div class="syntaxAction">tweets since, tweets, until</div>
                </div>
                <hr/>
                <div class="syntaxLine">
                    <div class="syntaxHint">-A</div>
                    <div class="syntaxAction"><strong>not</strong> A e.g. -is:retweet</div>
                </div>
                <div class="syntaxLine">
                    <div class="syntaxHint">A B</div>
                    <div class="syntaxAction">A <strong>and</strong> B</div>
                </div>
                <div class="syntaxLine">
                    <div class="syntaxHint">A <strong>OR</strong> B</div>
                    <div class="syntaxAction">A <strong>or</strong> B</div>
                </div>
                <div class="syntaxLine">
                    <div class="syntaxHint">"A B C"</div>
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
    init(router) {
        this._loading = false;
        this._activeSection = 'timeline';

        this.actives = new State({
            query: '',
            channel: new Channel({
                name: 'home',
                query: HOME_QUERY,
            }),
        });
        this.channels = new ChannelStore([]);
        this.tweets = new TweetStore();

        this.queryBar = new QueryBar({
            actives: this.actives,
        });
        this.sidebar = new Sidebar(this.channels, {
            actives: this.actives,
        });
        this.timeline = new Timeline(this.tweets, this.actives);
        this.stats = new Stats();

        this.actives.addHandler(() => this.fetchTimeline());
        this.channels.fetch().then(() => {
            // We can't properly resolve a deep link until when all the channels
            // have loaded, so we fire the router event again here.
            router.emitEvent();
        });
        this.channels.addHandler(() => this.channels.save());

        this.bind(router, ([name]) => {
            switch (name) {
                case 'sidebar':
                    this._activeSection = 'sidebar';
                    this.render();
                    return;
                case 'stats':
                    this._activeSection = 'stats';
                    this.render();
                    return;
                default:
                    this._activeSection = 'timeline';
                // fallthrough
            }

            const url = new URL(window.location.href);
            const searchParams = Object.fromEntries(url.searchParams);
            if (searchParams.q) {
                for (const chan of this.channels) {
                    if (chan.get('query') === searchParams.q) {
                        document.title = `${chan.get('name')} · Lucerne`;
                        this.actives.setActiveChannel(chan);
                        return;
                    }
                }

                document.title = `${searchParams.q} · Lucerne`;
                this.actives.update({
                    query: searchParams.q,
                });
            } else {
                const chan = this.channels.summarize()[0];
                if (!chan) return;
                router.gotoChannel(chan);
            }
        });
    }
    setLoading(loading) {
        this._loading = loading;
        this.render();
    }
    async fetchTimeline() {
        // wait for channels to load before doing anything
        if (!this.channels.records.size) return;

        const channel = this.actives.effectiveChannel();

        // don't re-fetch if already fetched/loaded
        if (this._fetchedQuery === channel.get('query')) return;
        this._fetchedQuery = channel.get('query');

        this.setLoading(true);
        const tweets = await channel.fetchTweets();
        // check again whether user has changed channel/query since fetch in initiated
        if (channel.get('query') != this.actives.effectiveChannel().get('query')) return;

        this.tweets.reset(tweets);
        this.setLoading(false);
    }
    compose() {
        return jdom`<div class="app">
            ${this.queryBar.node}
            <div class="sections show-${this._activeSection}">
                ${this.sidebar.node}
                ${this._loading ? jdom`<div class="bordered timeline">
                    <div class="timelineLoading" />
                </div>` : this.timeline.node}
                ${this.stats.node}
            </div>
        </div>`;
    }
}

class LucerneRouter extends Router {
    gotoQuery(query) {
        this.go(`/?q=${encodeURIComponent(query)}`);
    }
    gotoChannel(chan) {
        this.go(`/?q=${encodeURIComponent(chan.get('query'))}`);
    }
}

const router = new LucerneRouter({
    sidebar: '/chans',
    stats: '/stats',
    default: '/',
});

const dispatcher = new ShortcutDispatcher();
const app = new App(router);
document.getElementById('root').appendChild(app.node);

