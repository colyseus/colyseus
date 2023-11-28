import express from 'express';
import grant, { GrantProvider, GrantConfig, GrantSession } from 'grant';
import session from 'express-session';
import { auth } from './auth';

export type OAuthProviderName = '23andme' | '500px' | 'acton' | 'acuityscheduling' | 'adobe' | 'aha' | 'alchemer' | 'amazon' | 'angellist' | 'apple' | 'arcgis' | 'asana' | 'assembla' | 'atlassian' | 'auth0' | 'authentiq' | 'authing' | 'autodesk' | 'aweber' | 'axosoft' | 'baidu' | 'basecamp' | 'battlenet' | 'beatport' | 'bitbucket' | 'bitly' | 'box' | 'buffer' | 'campaignmonitor' | 'cas' | 'cheddar' | 'clio' | 'cognito' | 'coinbase' | 'concur' | 'constantcontact' | 'coursera' | 'crossid' | 'dailymotion' | 'deezer' | 'delivery' | 'deputy' | 'deviantart' | 'digitalocean' | 'discogs' | 'discord' | 'disqus' | 'docusign' | 'dribbble' | 'dropbox' | 'ebay' | 'echosign' | 'ecwid' | 'edmodo' | 'egnyte' | 'etsy' | 'eventbrite' | 'evernote' | 'eyeem' | 'facebook' | 'familysearch' | 'feedly' | 'figma' | 'fitbit' | 'flickr' | 'formstack' | 'foursquare' | 'freeagent' | 'freelancer' | 'freshbooks' | 'fusionauth' | 'garmin' | 'geeklist' | 'genius' | 'getbase' | 'getpocket' | 'gitbook' | 'github' | 'gitlab' | 'gitter' | 'goodreads' | 'google' | 'groove' | 'gumroad' | 'harvest' | 'hellosign' | 'heroku' | 'homeaway' | 'hootsuite' | 'huddle' | 'ibm' | 'iconfinder' | 'idme' | 'idonethis' | 'imgur' | 'infusionsoft' | 'instagram' | 'intuit' | 'jamendo' | 'jumplead' | 'kakao' | 'keycloak' | 'line' | 'linkedin' | 'live' | 'livechat' | 'logingov' | 'lyft' | 'mailchimp' | 'mailup' | 'mailxpert' | 'mapmyfitness' | 'mastodon' | 'medium' | 'meetup' | 'mendeley' | 'mention' | 'microsoft' | 'mixcloud' | 'moxtra' | 'myob' | 'naver' | 'nest' | 'netlify' | 'nokotime' | 'notion' | 'nylas' | 'okta' | 'onelogin' | 'openstreetmap' | 'optimizely' | 'osu' | 'patreon' | 'paypal' | 'phantauth' | 'pinterest' | 'plurk' | 'podio' | 'procore' | 'producthunt' | 'projectplace' | 'pushbullet' | 'qq' | 'ravelry' | 'redbooth' | 'reddit' | 'runkeeper' | 'salesforce' | 'sellsy' | 'shoeboxed' | 'shopify' | 'skyrock' | 'slack' | 'slice' | 'smartsheet' | 'smugmug' | 'snapchat' | 'snowflake' | 'socialpilot' | 'socrata' | 'soundcloud' | 'spotify' | 'square' | 'stackexchange' | 'stocktwits' | 'stormz' | 'storyblok' | 'strava' | 'stripe' | 'surveymonkey' | 'surveysparrow' | 'thingiverse' | 'ticketbud' | 'tiktok' | 'timelyapp' | 'todoist' | 'trakt' | 'traxo' | 'trello' | 'tripit' | 'trustpilot' | 'tumblr' | 'twitch' | 'twitter' | 'typeform' | 'uber' | 'unbounce' | 'underarmour' | 'unsplash' | 'untappd' | 'upwork' | 'uservoice' | 'vend' | 'venmo' | 'vercel' | 'verticalresponse' | 'viadeo' | 'vimeo' | 'visualstudio' | 'vk' | 'wechat' | 'weekdone' | 'weibo' | 'withings' | 'wordpress' | 'workos' | 'wrike' | 'xero' | 'xing' | 'yahoo' | 'yammer' | 'yandex' | 'zendesk' | 'zoom';
export type OAuthProviderConfig = {
  /**
   * consumer_key or client_id of your OAuth app
   */
  key: string;

  /**
   * consumer_secret or client_secret of your OAuth app
   */
  secret: string;

  /**
   * array of OAuth scopes to request
   */
  scope?: string[];

  /**
   * generate random nonce string (OpenID Connect only)
   */
  nonce?: boolean;

  /**
   * custom authorization parameters
   */
  custom_params?: any;

  /**
   * relative route or absolute URL to receive the response data /hello | https://site.com/hey
   */
  callback?: string;

  /**
   * relative route or absolute URL to receive the response data /hello | https://site.com/hey
   */
  response?: Array<'tokens' | 'raw' | 'jwt' | 'profile'>
}

// TODO: automatically set up Redis if RedisDriver is being used.

// import redis from "redis";
// import connectRedis from "connect-redis";

// const client = redis.createClient();
// const RedisStore = connectRedis(session);

export type OAuthCallback = (data: GrantSession['response'], provider: OAuthProviderName) => Promise<unknown>;
export let oAuthCallback: (data: GrantSession['response'], provider: OAuthProviderName) => Promise<unknown> = async (data, provider) => {
  console.debug("OAuth callback missing. Use oauth.onCallback() to persist user data.");
  return data;
};

export const oauth = {
  /**
   * Default 'grant' module configuration.
   */
  defaults: {
    // TODO: automatically retrieve "origin" based on "publicAddress" config [?]
    // origin: process.env.BACKEND_URL,
    transport: "session",
    state: true,
    response: ["tokens", "raw", "profile"],
  } as GrantProvider & { prefix: never },

  /**
   * Route prefix for OAuth routes.
   */
  prefix: "/provider",
  providers: {} as { [providerId in OAuthProviderName]: OAuthProviderConfig },

  /**
   * Add OAuth provider configuration.
   * @param providerId OAuth provider name
   * @param config OAuth provider configuration
   */
  addProvider: function (providerId: OAuthProviderName, config: OAuthProviderConfig) {
    this.providers[providerId] = config;
  },

  /**
   * Provides a callback function that is called when OAuth is successful.
   */
  onCallback: function (callback: OAuthCallback) {
    oAuthCallback = callback;
  },

  /**
   * Returns an Express Router that handles OAuth for configured providers.
   * @param callback (optional) Callback function that is called when OAuth is successful.
   * @returns Express Router
   */
  routes: function (callback?: OAuthCallback) {
    if (callback) { this.onCallback(callback); }

    const router = express.Router();

    const sessionMiddleware = session({
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false, // true
      // store: new RedisStore({ client: client }),
    });

    // set prefix
    const config: GrantConfig = Object.assign({ defaults: this.defaults }, this.providers);
    config.defaults.prefix = oauth.prefix;

    router.use(sessionMiddleware);

    router.get("/:providerId", async (req, res, next) => {
      const providerId = req.params.providerId as OAuthProviderName;
      if (oauth.providers[providerId]) {
        next();

      } else {
        // TODO: do not display help message on "production" environment.
        const jsonFilePath = '../oauth_help_urls.json';
        const helpURLs = (await import(jsonFilePath));
        const providerUrl = helpURLs[providerId];
        res.send(`<!doctype html>
<html>
<head>
<title>Missing "${providerId}" provider configuration</title>
<style>p { font-family: -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",Helvetica,Arial,sans-serif,"Apple Color Emoji","Segoe UI Emoji"; }</style>
</head>
<body>
<p>Missing config for "${providerId}" OAuth provider.</p>
<hr />
<p><small><strong>Config example:</strong></small></p>
<pre><code>import { oauth } from "@colyseus/auth";<br />
oauth.addProvider("${providerId}", {
  key: "xxx",
  secret: "xxx",
});
</code></pre>
${(providerUrl) ? `<hr/><p><small><em>(Get your keys from <a href="${providerUrl}" target="_blank">${providerUrl}</a>)</em></small></p>` : ""}
</body>
</html>`);
      }
    });

    router.use(grant.express(config));

    router.get("/:providerId/callback", async (req, res) => {
      const session = (req as any).session as unknown & { grant: GrantSession };

      let user = null;
      let token = null;
      let response = undefined;

      if (session.grant.response.error) {
        response = { error: session.grant.response.error, user, token, };

      } else {
        user = await oAuthCallback(session.grant.response, session.grant.provider as OAuthProviderName);
        token = await auth.settings.onGenerateToken(user);
        response = { user, token };
      }

      /**
       * I believe it is safe to use "*" in the origin here, since the token and origin are already validated by the OAuth provider.
       * => https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage
       */
      res.send(`<!DOCTYPE html><html><head><script type="text/javascript">window.opener.postMessage(${JSON.stringify(response)}, '*');</script></head><body></body></html>`);
      res.end();
    });

    return router;
  }
}