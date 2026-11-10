import { config } from 'dotenv';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

config({path:resolve(__dirname,'../.env'),quiet:true});
if(process.env.DEMO_MODE!=='true' || process.env.NODE_ENV==='production') throw new Error('Seed is development-demo only');
const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
const inventory=JSON.parse(readFileSync(resolve(__dirname,'demo-inventory.json'),'utf8')) as Prisma.PhoneNumberCreateInput[];
if(!Array.isArray(inventory) || inventory.length!==30) throw new Error('Expected 30 demonstration numbers');
const states = JSON.parse(readFileSync(resolve(__dirname, '../../src/lib/us-states.json'), 'utf8')) as {id: string; name: string; areaCodes: string[]}[];
const nationwide: Prisma.PhoneNumberCreateInput[] = states.flatMap(state => Array.from({length: 12}, (_, index) => ({
  number: `+1 ${state.areaCodes[index % state.areaCodes.length]} 555 ${String(100 + Math.floor(index / state.areaCodes.length)).padStart(4, '0')}`,
  countryCode: 'US', countryName: '美国', regionId: state.id, regionName: state.name,
})));
async function main() {
  try {
    for(const entry of [...inventory, ...nationwide]) {
      await db.phoneNumber.upsert({where:{number:entry.number},update:{},create:{...entry,provider:'demo'}});
    }
    console.log('Ensured demo inventory for all 50 US states and Washington, DC; existing leases and accounts were not changed.');
  } finally { await db.$disconnect(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
