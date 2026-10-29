// The 20-service sample that measures find-urls (M3.2: at least 80% must get a right pricing page). Each service's
// right answers were read on its official site on 2026-10-28: a page that lists its plans with their prices. Ten are
// the catalog's providers (their pricing sources), ten are from the queue.

export interface SampleService {
  id: string;
  name: string;
  website: string;
  domains?: string[];
  /** The pricing pages that count as right. */
  pricing: RegExp[];
}

export const urlSample: readonly SampleService[] = [
  {
    id: 'netflix',
    name: 'Netflix',
    website: 'https://www.netflix.com',
    pricing: [/help\.netflix\.com\/.*\/node\/24926/, /netflix\.com\/.*signup\/planform/],
  },
  {
    id: 'disney-plus',
    name: 'Disney+',
    website: 'https://www.disneyplus.com',
    pricing: [/help\.disneyplus\.com\/(?:[a-z-]+\/)?article\/disneyplus-(?:en-ca-)?price/i],
  },
  {
    id: 'crave',
    name: 'Crave',
    website: 'https://www.crave.ca',
    pricing: [/crave\.ca\/(?:en\/)?subscribe/],
  },
  {
    id: 'mullvad',
    name: 'Mullvad VPN',
    website: 'https://mullvad.net',
    pricing: [/mullvad\.net\/(?:[a-z]{2}\/)?pricing/],
  },
  {
    id: 'proton',
    name: 'Proton',
    website: 'https://proton.me',
    domains: ['protonvpn.com'],
    pricing: [/proton\.me\/(?:[a-z-]+\/)?pricing/, /protonvpn\.com\/pricing/],
  },
  {
    id: 'hulu',
    name: 'Hulu',
    website: 'https://www.hulu.com',
    pricing: [
      /help\.hulu\.com\/article\/.*(?:cost|price|plans)/,
      /hulu\.com\/(?:start|welcome|plans)/,
    ],
  },
  {
    id: 'espn',
    name: 'ESPN',
    website: 'https://www.espn.com',
    pricing: [
      /support\.espn\.com\/.*articles\/.*(?:plans|price)/i,
      /espn\.com\/(?:espnplus|watch)\/.*(?:plans|subscribe)/,
    ],
  },
  { id: 'tsn', name: 'TSN', website: 'https://www.tsn.ca', pricing: [/tsn\.ca\/subscribe/] },
  { id: 'rds', name: 'RDS', website: 'https://www.rds.ca', pricing: [/rds\.ca\/abonnement/] },
  {
    id: 'ici-tou-tv',
    name: 'ICI TOU.TV',
    website: 'https://ici.tou.tv',
    pricing: [/ici\.tou\.tv\/abonnement/],
  },
  {
    id: 'spotify',
    name: 'Spotify',
    website: 'https://www.spotify.com',
    pricing: [/spotify\.com\/(?:[a-z-]+\/)?premium/],
  },
  {
    id: 'youtube-premium',
    name: 'YouTube Premium',
    website: 'https://www.youtube.com/premium',
    pricing: [/youtube\.com\/premium/],
  },
  {
    id: 'crunchyroll',
    name: 'Crunchyroll',
    website: 'https://www.crunchyroll.com',
    pricing: [/crunchyroll\.com\/(?:[a-z-]+\/)?premium/],
  },
  {
    id: 'xbox-game-pass',
    name: 'Xbox Game Pass',
    website: 'https://www.xbox.com/xbox-game-pass',
    pricing: [/xbox\.com\/(?:[a-z]{2}-[a-z]{2}\/)?xbox-game-pass/i],
  },
  {
    id: 'dropbox',
    name: 'Dropbox',
    website: 'https://www.dropbox.com',
    pricing: [/dropbox\.com\/(?:[a-z_-]+\/)?(?:plans|pricing)/],
  },
  {
    id: 'nordvpn',
    name: 'NordVPN',
    website: 'https://nordvpn.com',
    pricing: [/nordvpn\.com\/(?:[a-z-]+\/)?pricing/],
  },
  {
    id: 'claude',
    name: 'Claude',
    website: 'https://claude.com',
    pricing: [/claude\.com\/pricing/, /anthropic\.com\/pricing/],
  },
  {
    id: 'tidal',
    name: 'Tidal',
    website: 'https://tidal.com',
    pricing: [/tidal\.com\/(?:[a-z-]+\/)?pricing/],
  },
  {
    id: 'deezer',
    name: 'Deezer',
    website: 'https://www.deezer.com',
    pricing: [/deezer\.com\/(?:[a-z-]+\/)?offers/],
  },
  {
    id: 'bitdefender',
    name: 'Bitdefender',
    website: 'https://www.bitdefender.com',
    // Its consumer lineup or one of its suites, not one product's page (its VPN alone) nor its business plans.
    pricing: [
      /bitdefender\.com\/(?:[a-z-]+\/)?consumer\/?$/,
      /bitdefender\.com\/(?:[a-z-]+\/)?consumer\/(?:compare|premium-security|total-security|ultimate-security)/,
    ],
  },
];
