import {
  afterCountryChange,
  locationModel,
  locationValues,
  type LocationModel,
} from './settings-form';

const ontario: LocationModel = {
  country: 'CA',
  subdivision: 'CA-ON',
  currency: 'CAD',
  currencyChosen: false,
  ownRate: false,
  salesTaxPercent: null,
};

describe('locationModel', () => {
  it('fills the form from saved settings', () => {
    expect(locationModel({ country: 'CA', subdivision: 'CA-ON', currency: 'CAD' })).toEqual(
      ontario,
    );
  });

  it('starts from defaults with no province, and knows the currency follows the country', () => {
    expect(locationModel({ country: 'CA', currency: 'CAD' })).toEqual({
      ...ontario,
      subdivision: '',
    });
  });

  it('remembers a currency the user picked, and their own rate', () => {
    expect(
      locationModel({ country: 'CA', subdivision: 'CA-QC', currency: 'EUR', salesTaxPercent: 5 }),
    ).toEqual({
      ...ontario,
      subdivision: 'CA-QC',
      currency: 'EUR',
      currencyChosen: true,
      ownRate: true,
      salesTaxPercent: 5,
    });
  });

  it('always asks a US user for their own rate', () => {
    expect(locationModel({ country: 'US', currency: 'USD' })).toMatchObject({
      ownRate: true,
      salesTaxPercent: null,
    });
  });
});

describe('locationValues', () => {
  it('saves the province, and no rate when the built-in one applies', () => {
    expect(locationValues(ontario)).toEqual({
      country: 'CA',
      subdivision: 'CA-ON',
      currency: 'CAD',
      salesTaxPercent: undefined,
    });
  });

  it('saves the user’s own rate only while it is chosen', () => {
    expect(locationValues({ ...ontario, ownRate: true, salesTaxPercent: 14 }).salesTaxPercent).toBe(
      14,
    );
    expect(
      locationValues({ ...ontario, ownRate: false, salesTaxPercent: 14 }).salesTaxPercent,
    ).toBeUndefined();
  });

  it('saves no state or rate when they are left empty', () => {
    const us: LocationModel = {
      ...ontario,
      country: 'US',
      subdivision: '',
      currency: 'USD',
      ownRate: true,
    };
    expect(locationValues(us)).toEqual({
      country: 'US',
      subdivision: undefined,
      currency: 'USD',
      salesTaxPercent: undefined,
    });
  });

  it('saves neither outside the countries where tax is added', () => {
    const gb = {
      ...ontario,
      country: 'GB',
      subdivision: 'CA-ON',
      ownRate: true,
      salesTaxPercent: 20,
    };
    expect(locationValues(gb)).toEqual({
      country: 'GB',
      subdivision: undefined,
      currency: 'CAD',
      salesTaxPercent: undefined,
    });
  });
});

describe('afterCountryChange', () => {
  it('clears the province and rate, and the currency follows the country', () => {
    const moved = { ...ontario, country: 'GB', ownRate: true, salesTaxPercent: 13 };
    expect(afterCountryChange(moved)).toEqual({
      ...ontario,
      country: 'GB',
      subdivision: '',
      currency: 'GBP',
      salesTaxPercent: null,
    });
  });

  it('keeps a currency the user picked', () => {
    expect(
      afterCountryChange({ ...ontario, country: 'GB', currency: 'USD', currencyChosen: true })
        .currency,
    ).toBe('USD');
  });

  it('shows US dollars where prices can’t be converted into the country’s currency', () => {
    expect(afterCountryChange({ ...ontario, country: 'AR' }).currency).toBe('USD');
  });

  it('asks a US user for their own rate', () => {
    expect(afterCountryChange({ ...ontario, country: 'US' })).toMatchObject({
      currency: 'USD',
      ownRate: true,
    });
  });
});
