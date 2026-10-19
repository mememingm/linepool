import type { Product } from './types';
import platforms from '../shared/platforms.json';

const platformMetadata = new Map(platforms.map(platform => [platform.name, platform]));
export const platformLogo = (service: string) => {
  const platform = platformMetadata.get(service);
  return platform ? `/services/${platform.id}.svg` : null;
};
export function platformList(products: Product[]) {
  const unique = new Map<string, Product>();
  for (const product of products) if (!unique.has(product.service)) unique.set(product.service, product);
  return [...unique.values()].sort((a, b) => a.service.localeCompare(b.service));
}
export const platformDescription = (service: string) => platformMetadata.get(service)?.description ?? '短信验证服务';
export const durationLabel = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes ? `${minutes} 分钟` : ''}${remainder ? ` ${remainder} 秒` : ''}`.trim();
};
