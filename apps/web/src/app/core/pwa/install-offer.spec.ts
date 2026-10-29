import { installOffer, installedHere, keepInstallOffer } from './install-offer';

// The browser's offer to install the app (M10.6): kept from the start with the browser's own banner held back, and
// gone once the app is installed from this tab.

describe('the install offer', () => {
  beforeAll(() => keepInstallOffer());

  afterEach(() => {
    installOffer.set(undefined);
    installedHere.set(false);
  });

  it('keeps the offer, holding back the browser’s own banner', () => {
    const offer = new Event('beforeinstallprompt', { cancelable: true });
    window.dispatchEvent(offer);
    expect(installOffer()).toBe(offer);
    expect(offer.defaultPrevented).toBe(true);
    expect(installedHere()).toBe(false);
  });

  it('drops it once the app is installed from this tab', () => {
    window.dispatchEvent(new Event('beforeinstallprompt', { cancelable: true }));
    window.dispatchEvent(new Event('appinstalled'));
    expect(installOffer()).toBeUndefined();
    expect(installedHere()).toBe(true);
  });
});
