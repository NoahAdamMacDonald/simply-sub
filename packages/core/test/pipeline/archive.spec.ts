import { describe, expect, it } from 'vitest';
import {
  archivedText,
  automationSchema,
  captureDate,
  captureUrl,
  newestCapture,
  newestCaptureQuery,
  onArchivedHost,
  readBaseline,
} from '../../src';

// Sites that turn bots away (M11.15): the Internet Archive's newest copy of a page, read for a change.

describe('onArchivedHost', () => {
  const hosts = ['openai.com', 'chatgpt.com'];

  it('takes a page on an archived host or its subdomains', () => {
    expect(onArchivedHost('https://chatgpt.com/pricing/', hosts)).toBe(true);
    expect(onArchivedHost('https://help.openai.com/en/articles/7232927', hosts)).toBe(true);
    expect(onArchivedHost('https://www.openai.com/policies/', hosts)).toBe(true);
  });

  it('leaves out other hosts, look-alikes and what isn’t a web address', () => {
    expect(onArchivedHost('https://claude.com/pricing', hosts)).toBe(false);
    expect(onArchivedHost('https://notopenai.com/', hosts)).toBe(false);
    expect(onArchivedHost('not a page', hosts)).toBe(false);
    expect(onArchivedHost('https://chatgpt.com/pricing/', [])).toBe(false);
  });
});

describe('the Wayback Machine’s addresses', () => {
  it('asks for the newest successful capture of the page', () => {
    expect(newestCaptureQuery('https://chatgpt.com/pricing/?a=1&b=2')).toBe(
      'https://web.archive.org/cdx/search/cdx?url=https%3A%2F%2Fchatgpt.com%2Fpricing%2F%3Fa%3D1%26b%3D2' +
        '&output=json&fl=timestamp%2Cstatuscode&filter=statuscode%3A200&limit=-1',
    );
  });

  it('reads a capture as the site served it, and its date', () => {
    expect(captureUrl('https://chatgpt.com/pricing/', '20261102071630')).toBe(
      'https://web.archive.org/web/20261102071630id_/https://chatgpt.com/pricing/',
    );
    expect(captureDate('20261102071630')).toBe('2026-11-02');
  });
});

describe('newestCapture', () => {
  it('gives the newest timestamp the answer lists', () => {
    const answer = JSON.stringify([
      ['timestamp', 'statuscode'],
      ['20261029125801', '200'],
      ['20261102071630', '200'],
    ]);
    expect(newestCapture(answer)).toBe('20261102071630');
  });

  it('gives none for no capture, an outage page or a broken answer', () => {
    expect(newestCapture('[]')).toBeUndefined();
    expect(newestCapture(JSON.stringify([['timestamp', 'statuscode']]))).toBeUndefined();
    expect(newestCapture('<html><title>Temporarily Offline</title></html>')).toBeUndefined();
    expect(newestCapture(JSON.stringify([['timestamp'], ['2026']]))).toBeUndefined();
  });
});

describe('archivedText', () => {
  it('reads the page as pageText does', () => {
    expect(archivedText('<h1>Pricing</h1><script>var a = 1;</script><p>Plus &amp; Pro</p>')).toBe(
      'Pricing\nPlus & Pro',
    );
  });

  it('leaves out lines that change with the day alone', () => {
    const html = [
      '<h1>Canceling your ChatGPT subscription</h1>',
      '<div>Updated: 3 hours ago</div>',
      '<div>Updated: yesterday</div>',
      '<div>Updated over a week ago</div>',
      '<div>Cancel at least 24 hours before your next billing date.</div>',
    ].join('');
    expect(archivedText(html)).toBe(
      'Canceling your ChatGPT subscription\nCancel at least 24 hours before your next billing date.',
    );
  });

  it('keeps a line that only mentions an update', () => {
    expect(archivedText('<p>Updated terms apply from 2026-12-01.</p>')).toBe(
      'Updated terms apply from 2026-12-01.',
    );
  });
});

describe('the settings and baselines', () => {
  const settings = {
    cadence: { pricing: 'daily', policies: 'weekly', logos: 'weekly', discovery: 'weekly' },
    digest: { day: 'monday' },
    reviewer: 'scheduled-claude',
    batch: { discovery: 3, browserPages: 5, neurons: 8000, reviewItems: 10 },
    search: [{ engine: 'searxng' }],
  };

  it('takes archived hosts as domains, or none', () => {
    expect(automationSchema.safeParse(settings).success).toBe(true);
    expect(
      automationSchema.safeParse({ ...settings, archived: ['chatgpt.com', 'openai.com'] }).success,
    ).toBe(true);
    expect(automationSchema.safeParse({ ...settings, archived: [] }).success).toBe(false);
    expect(
      automationSchema.safeParse({ ...settings, archived: ['https://chatgpt.com'] }).success,
    ).toBe(false);
  });

  it('reads a baseline taken from the archive', () => {
    expect(
      readBaseline(
        'url: https://chatgpt.com/pricing/\nmethod: archive\nsaved: 2026-11-04\n\nPricing\n',
      ),
    ).toEqual({
      url: 'https://chatgpt.com/pricing/',
      method: 'archive',
      saved: '2026-11-04',
      lines: ['Pricing'],
    });
  });
});
