import {
  countryChoices,
  currencyChoices,
  moneyText,
  percentText,
  placeSummary,
} from './place-names';

describe('place names', () => {
  it('lists every country by name', () => {
    expect(countryChoices).toHaveLength(249);
    expect(countryChoices).toContainEqual({ value: 'CA', label: 'Canada' });
    const labels = countryChoices.map((choice) => choice.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b, 'en')));
  });

  it('labels currencies with their code and name', () => {
    expect(currencyChoices).toContainEqual({ value: 'CAD', label: 'CAD — Canadian Dollar' });
  });

  it('sums up where the user is', () => {
    expect(placeSummary({ country: 'CA', subdivision: 'CA-ON', currency: 'CAD' })).toBe(
      'Ontario, Canada (CAD)',
    );
    expect(placeSummary({ country: 'GB', currency: 'GBP' })).toBe('United Kingdom (GBP)');
  });

  it('writes amounts as the user’s country does, with cents only when there are some', () => {
    expect(moneyText(200, 'CAD', 'CA')).toBe('$200');
    expect(moneyText(200, 'CAD', 'US')).toBe('CA$200');
    expect(moneyText(19.5, 'USD', 'US')).toBe('$19.50');
  });

  it('writes rates with up to three decimals', () => {
    expect(percentText(13)).toBe('13%');
    expect(percentText(14.975)).toBe('14.975%');
  });
});
