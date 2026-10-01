import { z } from 'zod';
/** Ownership only: date eligibility and assertion support remain independent gates.
 * Exact approved hosts; never infer ownership from a model suggestion or a CDN. */
export const PRIMARY_DOMAIN_REGISTRY_VERSION = 'primary-domains.20260927.v1';
const Entry = z.object({domain:z.string().regex(/^[a-z0-9.-]+$/), publisher:z.string().min(1), hosts:z.array(z.string().regex(/^[a-z0-9.-]+$/)).min(1), ownershipEvidenceUrl:z.url(), verifiedAt:z.iso.date()});
export const PRIMARY_DOMAIN_REGISTRY = z.array(Entry).max(100).parse([
  {
    "domain": "sec.gov",
    "publisher": "US Securities and Exchange Commission",
    "hosts": [
      "sec.gov",
      "www.sec.gov"
    ],
    "ownershipEvidenceUrl": "https://www.sec.gov",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "federalreserve.gov",
    "publisher": "Federal Reserve Board",
    "hosts": [
      "federalreserve.gov",
      "www.federalreserve.gov"
    ],
    "ownershipEvidenceUrl": "https://www.federalreserve.gov",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "bls.gov",
    "publisher": "Bureau of Labor Statistics",
    "hosts": [
      "bls.gov",
      "www.bls.gov"
    ],
    "ownershipEvidenceUrl": "https://www.bls.gov",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "bea.gov",
    "publisher": "Bureau of Economic Analysis",
    "hosts": [
      "bea.gov",
      "www.bea.gov"
    ],
    "ownershipEvidenceUrl": "https://www.bea.gov",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "treasury.gov",
    "publisher": "US Treasury",
    "hosts": [
      "treasury.gov",
      "www.treasury.gov",
      "home.treasury.gov"
    ],
    "ownershipEvidenceUrl": "https://home.treasury.gov",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "boj.or.jp",
    "publisher": "Bank of Japan",
    "hosts": [
      "boj.or.jp",
      "www.boj.or.jp"
    ],
    "ownershipEvidenceUrl": "https://www.boj.or.jp/en/",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "inter.co",
    "publisher": "Inter and Co",
    "hosts": [
      "inter.co",
      "www.inter.co",
      "investors.inter.co"
    ],
    "ownershipEvidenceUrl": "https://investors.inter.co",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "nubank.com.br",
    "publisher": "Nubank",
    "hosts": [
      "nubank.com.br",
      "www.nubank.com.br"
    ],
    "ownershipEvidenceUrl": "https://nubank.com.br/",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "nu.com",
    "publisher": "Nu Holdings",
    "hosts": [
      "nu.com",
      "www.nu.com"
    ],
    "ownershipEvidenceUrl": "https://nu.com/en/investors",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "investors.nu",
    "publisher": "Nu Holdings legacy IR redirect",
    "hosts": [
      "investors.nu",
      "www.investors.nu"
    ],
    "ownershipEvidenceUrl": "https://www.investors.nu",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "servicenow.com",
    "publisher": "ServiceNow",
    "hosts": [
      "servicenow.com",
      "www.servicenow.com",
      "investor.servicenow.com"
    ],
    "ownershipEvidenceUrl": "https://investor.servicenow.com",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "lvmh.com",
    "publisher": "LVMH",
    "hosts": [
      "lvmh.com",
      "www.lvmh.com"
    ],
    "ownershipEvidenceUrl": "https://www.lvmh.com/en",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "palantir.com",
    "publisher": "Palantir",
    "hosts": [
      "palantir.com",
      "www.palantir.com",
      "investors.palantir.com"
    ],
    "ownershipEvidenceUrl": "https://investors.palantir.com",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "microsoft.com",
    "publisher": "Microsoft",
    "hosts": [
      "microsoft.com",
      "www.microsoft.com"
    ],
    "ownershipEvidenceUrl": "https://www.microsoft.com/en-us/investor/default",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "apple.com",
    "publisher": "Apple",
    "hosts": [
      "apple.com",
      "www.apple.com",
      "investor.apple.com"
    ],
    "ownershipEvidenceUrl": "https://investor.apple.com",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "nvidia.com",
    "publisher": "NVIDIA",
    "hosts": [
      "nvidia.com",
      "www.nvidia.com",
      "investor.nvidia.com"
    ],
    "ownershipEvidenceUrl": "https://investor.nvidia.com",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "broadcom.com",
    "publisher": "Broadcom",
    "hosts": [
      "broadcom.com",
      "www.broadcom.com",
      "investors.broadcom.com"
    ],
    "ownershipEvidenceUrl": "https://investors.broadcom.com",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "abc.xyz",
    "publisher": "Alphabet",
    "hosts": [
      "abc.xyz",
      "www.abc.xyz"
    ],
    "ownershipEvidenceUrl": "https://abc.xyz/investor/",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "tesla.com",
    "publisher": "Tesla",
    "hosts": [
      "tesla.com",
      "www.tesla.com",
      "ir.tesla.com"
    ],
    "ownershipEvidenceUrl": "https://ir.tesla.com",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "intel.com",
    "publisher": "Intel",
    "hosts": [
      "intel.com",
      "www.intel.com"
    ],
    "ownershipEvidenceUrl": "https://www.intel.com",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "intc.com",
    "publisher": "Intel investor relations",
    "hosts": [
      "intc.com",
      "www.intc.com"
    ],
    "ownershipEvidenceUrl": "https://www.intc.com",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "coherent.com",
    "publisher": "Coherent",
    "hosts": [
      "coherent.com",
      "www.coherent.com"
    ],
    "ownershipEvidenceUrl": "https://www.coherent.com",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "lumentum.com",
    "publisher": "Lumentum",
    "hosts": [
      "lumentum.com",
      "www.lumentum.com",
      "investor.lumentum.com"
    ],
    "ownershipEvidenceUrl": "https://investor.lumentum.com",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "ssrmining.com",
    "publisher": "SSR Mining",
    "hosts": [
      "ssrmining.com",
      "www.ssrmining.com"
    ],
    "ownershipEvidenceUrl": "https://www.ssrmining.com",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "coreweave.com",
    "publisher": "CoreWeave",
    "hosts": [
      "coreweave.com",
      "www.coreweave.com",
      "investors.coreweave.com"
    ],
    "ownershipEvidenceUrl": "https://investors.coreweave.com",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "nebius.com",
    "publisher": "Nebius",
    "hosts": [
      "nebius.com",
      "www.nebius.com"
    ],
    "ownershipEvidenceUrl": "https://nebius.com/investor-hub",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "atmeta.com",
    "publisher": "Meta investor relations",
    "hosts": [
      "investor.atmeta.com"
    ],
    "ownershipEvidenceUrl": "https://investor.atmeta.com",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "meta.com",
    "publisher": "Meta corporate information",
    "hosts": [
      "about.meta.com"
    ],
    "ownershipEvidenceUrl": "https://about.meta.com",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "fb.com",
    "publisher": "Meta newsroom",
    "hosts": [
      "about.fb.com"
    ],
    "ownershipEvidenceUrl": "https://about.fb.com",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "openai.com",
    "publisher": "OpenAI",
    "hosts": [
      "openai.com",
      "www.openai.com"
    ],
    "ownershipEvidenceUrl": "https://openai.com/about/",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "anthropic.com",
    "publisher": "Anthropic",
    "hosts": [
      "anthropic.com",
      "www.anthropic.com"
    ],
    "ownershipEvidenceUrl": "https://www.anthropic.com/company",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "credosemi.com",
    "publisher": "Credo",
    "hosts": [
      "credosemi.com",
      "www.credosemi.com",
      "investors.credosemi.com"
    ],
    "ownershipEvidenceUrl": "https://investors.credosemi.com",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "dutchbros.com",
    "publisher": "Dutch Bros",
    "hosts": [
      "dutchbros.com",
      "www.dutchbros.com",
      "investors.dutchbros.com"
    ],
    "ownershipEvidenceUrl": "https://investors.dutchbros.com",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "opendoor.com",
    "publisher": "Opendoor",
    "hosts": [
      "opendoor.com",
      "www.opendoor.com",
      "investor.opendoor.com"
    ],
    "ownershipEvidenceUrl": "https://investor.opendoor.com",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "amd.com",
    "publisher": "AMD",
    "hosts": [
      "amd.com",
      "www.amd.com",
      "ir.amd.com"
    ],
    "ownershipEvidenceUrl": "https://ir.amd.com",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "oracle.com",
    "publisher": "Oracle",
    "hosts": [
      "oracle.com",
      "www.oracle.com",
      "investor.oracle.com"
    ],
    "ownershipEvidenceUrl": "https://investor.oracle.com",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "adobe.com",
    "publisher": "Adobe",
    "hosts": [
      "adobe.com",
      "www.adobe.com"
    ],
    "ownershipEvidenceUrl": "https://www.adobe.com/investor-relations.html",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "delltechnologies.com",
    "publisher": "Dell Technologies",
    "hosts": [
      "delltechnologies.com",
      "www.delltechnologies.com",
      "investors.delltechnologies.com"
    ],
    "ownershipEvidenceUrl": "https://investors.delltechnologies.com",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "micron.com",
    "publisher": "Micron",
    "hosts": [
      "micron.com",
      "www.micron.com",
      "investors.micron.com"
    ],
    "ownershipEvidenceUrl": "https://investors.micron.com",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "aboutamazon.com",
    "publisher": "Amazon corporate and investor relations",
    "hosts": [
      "aboutamazon.com",
      "www.aboutamazon.com",
      "ir.aboutamazon.com"
    ],
    "ownershipEvidenceUrl": "https://ir.aboutamazon.com",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "asteralabs.com",
    "publisher": "Astera Labs",
    "hosts": [
      "asteralabs.com",
      "www.asteralabs.com",
      "ir.asteralabs.com"
    ],
    "ownershipEvidenceUrl": "https://ir.asteralabs.com",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "lundinmining.com",
    "publisher": "Lundin Mining",
    "hosts": [
      "lundinmining.com",
      "www.lundinmining.com"
    ],
    "ownershipEvidenceUrl": "https://www.lundinmining.com",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "ondas.com",
    "publisher": "Ondas",
    "hosts": [
      "ondas.com",
      "www.ondas.com",
      "ir.ondas.com"
    ],
    "ownershipEvidenceUrl": "https://ir.ondas.com",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "coinbase.com",
    "publisher": "Coinbase",
    "hosts": [
      "coinbase.com",
      "www.coinbase.com",
      "investor.coinbase.com"
    ],
    "ownershipEvidenceUrl": "https://investor.coinbase.com",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "redditinc.com",
    "publisher": "Reddit corporate investor relations",
    "hosts": [
      "redditinc.com",
      "www.redditinc.com",
      "investor.redditinc.com"
    ],
    "ownershipEvidenceUrl": "https://investor.redditinc.com",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "ibm.com",
    "publisher": "IBM",
    "hosts": [
      "ibm.com",
      "www.ibm.com"
    ],
    "ownershipEvidenceUrl": "https://www.ibm.com/investor",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "vistracorp.com",
    "publisher": "Vistra",
    "hosts": [
      "vistracorp.com",
      "www.vistracorp.com",
      "investor.vistracorp.com"
    ],
    "ownershipEvidenceUrl": "https://investor.vistracorp.com",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "nscale.com",
    "publisher": "Nscale",
    "hosts": [
      "nscale.com",
      "www.nscale.com"
    ],
    "ownershipEvidenceUrl": "https://www.nscale.com",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "transdigm.com",
    "publisher": "TransDigm",
    "hosts": [
      "transdigm.com",
      "www.transdigm.com"
    ],
    "ownershipEvidenceUrl": "https://www.transdigm.com/investor-relations/",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "nike.com",
    "publisher": "Nike",
    "hosts": [
      "nike.com",
      "www.nike.com",
      "investors.nike.com"
    ],
    "ownershipEvidenceUrl": "https://investors.nike.com",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "americanexpress.com",
    "publisher": "American Express",
    "hosts": [
      "americanexpress.com",
      "www.americanexpress.com",
      "ir.americanexpress.com"
    ],
    "ownershipEvidenceUrl": "https://ir.americanexpress.com",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "sofi.com",
    "publisher": "SoFi",
    "hosts": [
      "sofi.com",
      "www.sofi.com",
      "investors.sofi.com"
    ],
    "ownershipEvidenceUrl": "https://investors.sofi.com",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "ally.com",
    "publisher": "Ally",
    "hosts": [
      "ally.com",
      "www.ally.com"
    ],
    "ownershipEvidenceUrl": "https://www.ally.com/about/investor/",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "wise.com",
    "publisher": "Wise",
    "hosts": [
      "wise.com",
      "www.wise.com",
      "owners.wise.com"
    ],
    "ownershipEvidenceUrl": "https://owners.wise.com/",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "costco.com",
    "publisher": "Costco",
    "hosts": [
      "costco.com",
      "www.costco.com",
      "investor.costco.com"
    ],
    "ownershipEvidenceUrl": "https://investor.costco.com",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "mercadolibre.com",
    "publisher": "MercadoLibre",
    "hosts": [
      "mercadolibre.com",
      "www.mercadolibre.com",
      "investor.mercadolibre.com"
    ],
    "ownershipEvidenceUrl": "https://investor.mercadolibre.com",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "tecnoglass.com",
    "publisher": "Tecnoglass",
    "hosts": [
      "tecnoglass.com",
      "www.tecnoglass.com",
      "investors.tecnoglass.com"
    ],
    "ownershipEvidenceUrl": "https://investors.tecnoglass.com",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "stone.co",
    "publisher": "StoneCo",
    "hosts": [
      "stone.co",
      "www.stone.co",
      "investors.stone.co"
    ],
    "ownershipEvidenceUrl": "https://investors.stone.co",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "bloomenergy.com",
    "publisher": "Bloom Energy",
    "hosts": [
      "bloomenergy.com",
      "www.bloomenergy.com",
      "investor.bloomenergy.com"
    ],
    "ownershipEvidenceUrl": "https://investor.bloomenergy.com",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "banyangold.com",
    "publisher": "Banyan Gold",
    "hosts": [
      "banyangold.com",
      "www.banyangold.com"
    ],
    "ownershipEvidenceUrl": "https://banyangold.com",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "cabralgold.com",
    "publisher": "Cabral Gold",
    "hosts": [
      "cabralgold.com",
      "www.cabralgold.com"
    ],
    "ownershipEvidenceUrl": "https://cabralgold.com",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "newpacificmetals.com",
    "publisher": "New Pacific Metals",
    "hosts": [
      "newpacificmetals.com",
      "www.newpacificmetals.com"
    ],
    "ownershipEvidenceUrl": "https://www.newpacificmetals.com",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "1911gold.com",
    "publisher": "1911 Gold",
    "hosts": [
      "1911gold.com",
      "www.1911gold.com"
    ],
    "ownershipEvidenceUrl": "https://1911gold.com",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "mcewenmining.com",
    "publisher": "McEwen",
    "hosts": [
      "mcewenmining.com",
      "www.mcewenmining.com"
    ],
    "ownershipEvidenceUrl": "https://mcewenmining.com",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "artemisgoldinc.com",
    "publisher": "Artemis Gold",
    "hosts": [
      "artemisgoldinc.com",
      "www.artemisgoldinc.com"
    ],
    "ownershipEvidenceUrl": "https://www.artemisgoldinc.com",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "gogoldresources.com",
    "publisher": "GoGold Resources",
    "hosts": [
      "gogoldresources.com",
      "www.gogoldresources.com"
    ],
    "ownershipEvidenceUrl": "https://www.gogoldresources.com",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "marvell.com",
    "publisher": "Marvell",
    "hosts": [
      "marvell.com",
      "www.marvell.com",
      "investor.marvell.com"
    ],
    "ownershipEvidenceUrl": "https://investor.marvell.com",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "autodesk.com",
    "publisher": "Autodesk",
    "hosts": [
      "autodesk.com",
      "www.autodesk.com",
      "investors.autodesk.com"
    ],
    "ownershipEvidenceUrl": "https://investors.autodesk.com",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "bankofamerica.com",
    "publisher": "Bank of America",
    "hosts": [
      "bankofamerica.com",
      "www.bankofamerica.com",
      "investor.bankofamerica.com"
    ],
    "ownershipEvidenceUrl": "https://investor.bankofamerica.com",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "remitly.com",
    "publisher": "Remitly",
    "hosts": [
      "remitly.com",
      "www.remitly.com",
      "ir.remitly.com"
    ],
    "ownershipEvidenceUrl": "https://ir.remitly.com",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "wingstop.com",
    "publisher": "Wingstop",
    "hosts": [
      "wingstop.com",
      "www.wingstop.com",
      "ir.wingstop.com"
    ],
    "ownershipEvidenceUrl": "https://ir.wingstop.com",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "oscarhealth.com",
    "publisher": "Oscar Health",
    "hosts": [
      "oscarhealth.com",
      "www.oscarhealth.com",
      "ir.oscarhealth.com"
    ],
    "ownershipEvidenceUrl": "https://ir.oscarhealth.com/",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "owletcare.com",
    "publisher": "Owlet",
    "hosts": [
      "owletcare.com",
      "www.owletcare.com",
      "investors.owletcare.com"
    ],
    "ownershipEvidenceUrl": "https://investors.owletcare.com",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "kellypartnersgroup.com.au",
    "publisher": "Kelly Partners Group",
    "hosts": [
      "kellypartnersgroup.com.au",
      "www.kellypartnersgroup.com.au"
    ],
    "ownershipEvidenceUrl": "https://www.kellypartnersgroup.com.au",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "turningpointbrands.com",
    "publisher": "Turning Point Brands",
    "hosts": [
      "turningpointbrands.com",
      "www.turningpointbrands.com"
    ],
    "ownershipEvidenceUrl": "https://www.turningpointbrands.com",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "verramobility.com",
    "publisher": "Verra Mobility",
    "hosts": [
      "verramobility.com",
      "www.verramobility.com",
      "ir.verramobility.com"
    ],
    "ownershipEvidenceUrl": "https://ir.verramobility.com",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "homedepot.com",
    "publisher": "Home Depot",
    "hosts": [
      "homedepot.com",
      "www.homedepot.com",
      "ir.homedepot.com"
    ],
    "ownershipEvidenceUrl": "https://ir.homedepot.com",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "ulta.com",
    "publisher": "Ulta Beauty",
    "hosts": [
      "ulta.com",
      "www.ulta.com"
    ],
    "ownershipEvidenceUrl": "https://www.ulta.com/investor",
    "verifiedAt": "2026-09-27"
  },
  {
    "domain": "paloaltonetworks.com",
    "publisher": "Palo Alto Networks",
    "hosts": [
      "paloaltonetworks.com",
      "www.paloaltonetworks.com",
      "investors.paloaltonetworks.com"
    ],
    "ownershipEvidenceUrl": "https://investors.paloaltonetworks.com",
    "verifiedAt": "2026-09-27"
  }
]);
export const PRIMARY_DOMAINS = PRIMARY_DOMAIN_REGISTRY.map(entry=>entry.domain).sort();
/** Requested filters cannot confer primary status on an unverified publisher. */
export function isVerifiedPrimaryHost(host: string, requestedDomains: string[] = PRIMARY_DOMAINS) {
  const normalized = host.toLowerCase();
  return PRIMARY_DOMAIN_REGISTRY.some(entry => entry.hosts.includes(normalized) &&
    requestedDomains.some(domain => normalized === domain || normalized.endsWith('.'+domain)));
}
