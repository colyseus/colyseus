import fs from 'fs';
import path from 'path';
import express, { Router } from 'express';
import grant, { type GrantProvider, type GrantConfig, type GrantSession } from 'grant';
import session from 'express-session';
import { matchMaker } from '@colyseus/core';
import { type MayHaveUpgradeToken, auth } from './auth.ts';

// @ts-ignore
import RedisStore from "connect-redis";
import { JWT } from './JWT.ts';

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

export type OAuthProviderCallback = (data: GrantSession['response'] & MayHaveUpgradeToken, provider: OAuthProviderName) => Promise<unknown>;
export let oAuthProviderCallback: (data: GrantSession['response'] & MayHaveUpgradeToken, provider: OAuthProviderName) => Promise<unknown> = async (data, provider) => {
  console.debug("OAuth callback missing. Use oauth.onCallback() to persist user data.");
  return data;
};

export const oauth = {
  /**
   * Default 'grant' module configuration.
   */
  defaults: {
    transport: "session",
    state: true,
    response: ["tokens", "raw", "profile"],
    // Allow 'origin' to be set dynamically per-request
    // (needed when origin is auto-detected after grant middleware is initialized)
    dynamic: ['origin'],
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
  onCallback: function (callback: OAuthProviderCallback) {
    oAuthProviderCallback = callback;
  },

  /**
   * Returns an Express Router that handles OAuth for configured providers.
   * @param callback (optional) Callback function that is called when OAuth is successful.
   * @returns Express Router
   */
  routes: function (callback?: OAuthProviderCallback): Router {
    if (callback) { this.onCallback(callback); }

    const router = express.Router();

    matchMaker.onReady.then(() => {
      //
      // Here we are using the same Redis connection from the MatchMaker.
      // FIXME: make it type-safe. (This is a hacky way to auto-detection)
      //
      const store = (matchMaker.presence['pub'])
        ? new RedisStore({ client: matchMaker.presence['pub'] })
        : undefined;

      const sessionMiddleware = session({
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false, // true
        store
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
          if (process.env.NODE_ENV === "production") {
            //
            // Production environment:
            //
            res.send(`Missing OAuth provider configuration for "${providerId}".`);

          } else {
            //
            // Development environment:
            // Display help URL for missing OAuth provider configuration
            //
            const helpURLs = JSON.parse(fs.readFileSync(path.normalize(__dirname + '/../oauth_help_urls.json')).toString());
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
<pre><code>import { auth } from "@colyseus/auth";<br />
auth.oauth.addProvider("${providerId}", {
  key: "xxx",
  secret: "xxx",
});
</code></pre>
${(providerUrl) ? `<hr/><p><small><em>(Get your keys from <a href="${providerUrl}" target="_blank">${providerUrl}</a>)</em></small></p>` : ""}
</body>
</html>`);
          }
        }
      });

      //
      // Dynamically inject origin for grant per-request.
      // This handles the case where origin is auto-detected after grant was initialized.
      // Grant reads dynamic overrides from res.locals.grant.dynamic
      //
      router.use((req, res, next) => {
        const dynamicOrigin = oauth.defaults.origin || auth.backend_url;
        if (dynamicOrigin) {
          res.locals.grant = {
            dynamic: { origin: dynamicOrigin }
          };
        }
        next();
      });

      router.use(grant.default.express(config));

      router.get("/:providerId/callback", async (req, res) => {
        const session = (req as any).session as unknown & { grant: GrantSession };

        let user = null;
        let token = null;
        let response = undefined;

        if (session.grant.response.error) {
          response = { error: session.grant.response.error, user, token, };

        } else {
          const data: GrantSession['response'] & MayHaveUpgradeToken = session.grant.response;

          /**
           * Verify existing token, if available
           * (Upgrading user)
           */
          if (session.grant.dynamic?.token) {
            data.upgradingToken = await JWT.verify(session.grant.dynamic?.token);
          }

          // transform profile data
          if (data.profile) {
            data.profile = oauth.transformProfileData(data.profile);
          }

          user = await oAuthProviderCallback(data, session.grant.provider as OAuthProviderName);
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
    });

    return router;
  },

  /**
   * Transform raw profile data into a single object.
   * (e.g. Twitch returns an array of profiles, but we only need the first one)
   * @param raw
   */
  transformProfileData(raw: any) {
    if (raw.data && Array.isArray(raw.data) && raw.data.length === 1) {
      //
      // Twitch:
      // Twitch returns an array of profiles, but we only need the first one
      //
      return raw.data[0];
    } else {
      //
      // Fallback: return raw data
      //
      return raw;
    }
  }
}