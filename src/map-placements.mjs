import fs from 'node:fs/promises';

// Read-only, narrowly scoped MCC Halo 3 v13 inspection. Header/index and pointer
// layout cross-checked with Reclaimer.Blam's MccHalo3 CacheFileU6/CacheFile,
// TagAddressTranslator and PointerExpander. Scenario offsets additionally match
// the installed Kit's embedded schema. Never writes a .map.
export async function inspectVehicles(file) {
  const handle=await fs.open(file,'r');
  try {
    const size=(await handle.stat()).size;
    async function read(offset,length) {
      if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(length)||length<0||length>128*1024*1024||offset+length>size)throw Error('Map read outside validated bounds.');
      const b=Buffer.alloc(length);const {bytesRead}=await handle.read(b,0,length,offset);if(bytesRead!==length)throw Error('Truncated map.');return b;
    }
    const header=await read(0,16384);
    if(header.readUInt32LE(0)!==0x68656164||header.readUInt32LE(4)!==13)throw Error('Expected MCC Halo 3 v13 map.');
    const tagSection=header.readUInt32LE(1260)+header.readInt32LE(1236),virtualBase=Number(header.readBigUInt64LE(736)),magic=virtualBase-tagSection;
    const ptr=p=>p*4-magic;
    const index=await read(Number(header.readBigUInt64LE(744))-magic,72),classCount=index.readUInt32LE(0),tagCount=index.readUInt32LE(16);
    if(classCount>1000||tagCount>65535)throw Error('Unexpected tag index size.');
    const classes=await read(Number(index.readBigUInt64LE(8))-magic,classCount*16),entries=await read(Number(index.readBigUInt64LE(24))-magic,tagCount*8);
    const names=await read(header.readUInt32LE(36)+header.readInt32LE(1228),header.readUInt32LE(40)),nameOffsets=await read(header.readUInt32LE(44)+header.readInt32LE(1228),tagCount*4);
    const tags=[];
    for(let i=0;i<tagCount;i++){
      const cls=entries.readInt16LE(i*8);if(cls<0){tags.push(null);continue;}if(cls>=classCount)throw Error('Invalid tag class.');
      const no=nameOffsets.readInt32LE(i*4);if(no<0||no>=names.length)throw Error('Invalid tag name offset.');const end=names.indexOf(0,no);if(end<no)throw Error('Unterminated tag name.');
      tags.push({index:i,group:Buffer.from(classes.subarray(cls*16,cls*16+4)).reverse().toString('ascii'),name:names.toString('utf8',no,end),offset:ptr(entries.readUInt32LE(i*8+4))});
    }
    const scenarioName=header.toString('utf8',224,480).split('\0')[0],scenario=tags.find(t=>t?.group==='scnr'&&t.name===scenarioName);
    if(!scenario)throw Error('Scenario tag not found.');
    const scnr=await read(scenario.offset,0x130);
    const vehicleCount=scnr.readUInt32LE(0xe4),paletteCount=scnr.readUInt32LE(0xf0);
    if(vehicleCount>65535||paletteCount>65535)throw Error('Unexpected vehicle block size.');
    const paletteData=await read(ptr(scnr.readUInt32LE(0xf4)),paletteCount*16),palette=[];
    for(let i=0;i<paletteCount;i++){
      const datum=paletteData.readUInt32LE(i*16+12),tag=datum===0xffffffff?null:tags[datum&0xffff];
      if(tag&&tag.group!=='vehi')throw Error('Vehicle palette references a non-vehicle.');palette.push({index:i,datum,tag});
    }
    const stride=0xa8,raw=await read(ptr(scnr.readUInt32LE(0xe8)),vehicleCount*stride),vehicles=[];
    for(let i=0;i<vehicleCount;i++){
      const row=raw.subarray(i*stride,(i+1)*stride),paletteIndex=row.readInt16LE(0);
      if(paletteIndex<0||paletteIndex>=paletteCount)throw Error('Invalid vehicle palette index; unsupported layout.');
      const position=[8,12,16].map(p=>row.readFloatLE(p)),rotation=[20,24,28].map(p=>row.readFloatLE(p)),scale=row.readFloatLE(32);
      if(![...position,...rotation,scale].every(Number.isFinite))throw Error('Invalid vehicle transform.');
      vehicles.push({index:i,paletteIndex,tag:palette[paletteIndex].tag,position,rotation,scale,flags:row.readUInt32LE(4),rawHex:row.toString('hex')});
    }
    return {file,scenario,tagCount,vehicleCount,paletteCount,palette,vehicles};
  }finally{await handle.close();}
}
