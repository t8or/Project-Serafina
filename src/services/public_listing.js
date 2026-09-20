/** Narrow, keyless reader for the public Zillow building page supplied by a user.
 * No search API, login, browser challenge handling, or arbitrary URL fetching.
 */
import crypto from 'node:crypto';
import { buildNormalizedAddress } from './property_service.js';

export function listingUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Enter a Zillow apartment listing URL.'); }
  if (url.protocol !== 'https:' || url.hostname !== 'www.zillow.com' || url.port || url.username || url.password || !/^\/apartments\/[^/]+\/[^/]+\/[^/]+\/$/.test(url.pathname)) {
    throw new Error('Use an https://www.zillow.com/apartments/ listing URL.');
  }
  url.search = ''; url.hash = '';
  return url.href;
}

export function parseListing(html, address, url, now = new Date().toISOString()) {
  const match = html.match(/<script\b(?=[^>]*\bid=["']__NEXT_DATA__["'])[^>]*>([\s\S]*?)<\/script>/i);
  if (!match) throw new Error('This page did not provide readable listing data. Open the source and enter the values below.');
  let building;
  try { building = JSON.parse(match[1])?.props?.pageProps?.componentProps?.initialReduxState?.gdp?.building; } catch { /* reported below */ }
  if (!building) throw new Error('The listing format has changed. Open the source and enter the values below.');
  const found = {street: building.streetAddress, city: building.city, stateAbbr: building.state, zipCode: building.zipcode};
  if (!found.street || !found.city || !found.stateAbbr || !address.street || !address.city || !address.stateAbbr || buildNormalizedAddress(found) !== buildNormalizedAddress(address)) {
    throw new Error('The listing address does not match this property. Check the street, city, and state.');
  }
  const observations = {};
  const add = (key, value, notes, scope) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return;
    const max = key === 'schoolRatings' ? 10 : 100;
    if (value < 0 || value > max) return;
    observations[key] = { value, sourceUrl: url, observedAt: now, scope, notes, method: 'public_listing', sourceHash: crypto.createHash('sha256').update(match[1]).digest('hex') };
  };
  add('walkScore', building.walkScore?.walkscore, 'Walk Score, published on Zillow.', 'property');
  add('transitScore', building.transitScore?.transit_score, 'Transit Score, published on Zillow.', 'property');
  const schools = (building.assignedSchools || []).filter(s => s.isAssigned === true && s.type === 'PUBLIC' && typeof s.rating === 'number' && s.rating >= 1 && s.rating <= 10);
  const unique = [...new Map(schools.map(s => [s.schoolId || s.name, s])).values()];
  if (unique.length) {
    const notes = unique.map(s => `${s.name}: ${s.rating}/10`).join('; ');
    add('schoolRatings', unique.reduce((sum,s) => sum+s.rating,0)/unique.length, `Mean of ${unique.length} rated assigned public schools. ${notes}`, 'assigned_schools');
  }
  if (!Object.keys(observations).length) throw new Error('No supported scores were published on this listing.');
  return { observations, matchedAddress: found, sourceUrl: url, unavailable: ['walkScore','transitScore','schoolRatings'].filter(k => !observations[k]) };
}

export async function readPublicListing(value, address, fetcher = fetch) {
  const url = listingUrl(value);
  const response = await fetcher(url, {redirect:'manual', signal:AbortSignal.timeout(15000), headers:{Accept:'text/html'}});
  if (!response.ok) throw new Error(`The site did not allow this lookup (HTTP ${response.status}). Open the source and enter the values below.`);
  if (!response.headers.get('content-type')?.includes('text/html')) throw new Error('The source did not return a listing page.');
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try {
    while (true) {
      const {value,done} = await reader.read(); if (done) break;
      size += value.length;
      if (size > 4_000_000) throw new Error('The source page is too large to read.');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return parseListing(Buffer.concat(chunks).toString('utf8'), address, url);
}
