import { type GrantProvider, type GrantSession } from 'grant';
import { type MayHaveUpgradeToken } from './auth.ts';

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