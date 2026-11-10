import { isStorefrontRegion } from '../api/contracts';
import type { Catalog } from '../api/contracts';

// Keep the storefront aligned with the currently supported checkout and fulfillment scope.
export function saleRegions(catalog: Catalog) {
  return catalog.regions.filter(region => isStorefrontRegion(region.id));
}

export function saleOffers(catalog: Catalog) {
  return catalog.offers.filter(offer => isStorefrontRegion(offer.region) && (offer.receivingMode === 'ONE_TIME'
    ? offer.durationDays === null && offer.windowMinutes === 15
    : offer.durationDays === 7 || offer.durationDays === 30));
}
export function cheapestSaleOffer(catalog: Catalog, region: string) {
  return saleOffers(catalog).filter(offer => offer.region === region && offer.availableCount > 0)
    .sort((a, b) => a.unitPoints - b.unitPoints || (a.durationDays ?? 0) - (b.durationDays ?? 0))[0];
}
