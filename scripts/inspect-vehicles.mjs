import {inspectVehicles} from '../src/map-placements.mjs';
const result=await inspectVehicles(process.argv[2]);
console.log(JSON.stringify({...result,vehicles:result.vehicles.filter(v=>v.tag?.name.includes('pelican')||v.index===0)},null,2));
