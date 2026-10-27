import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
// Install @gltf-transform/cli@4.1.1 outside the runtime and pass its prefix.
const require = createRequire(path.resolve(process.argv[2] || '.', 'package.json'));
const {NodeIO} = require('@gltf-transform/core');
const {ALL_EXTENSIONS,EXTMeshoptCompression} = require('@gltf-transform/extensions');
const {MeshoptEncoder,MeshoptDecoder} = require('meshoptimizer');
await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const root=new URL('../../', import.meta.url).pathname;
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.encoder':MeshoptEncoder,'meshopt.decoder':MeshoptDecoder});
const report=JSON.parse(fs.readFileSync(root+'docs/model-compression.json'));
function signature(doc){const r=doc.getRoot();const indices=new Set(r.listMeshes().flatMap(m=>m.listPrimitives().map(p=>p.getIndices())));return {accessors:r.listAccessors().map(a=>{let values=Array.from(a.getArray());if(indices.has(a)){const tris=[];for(let i=0;i<values.length;i+=3){const t=values.slice(i,i+3),min=Math.min(...t),pos=t.indexOf(min);tris.push(t.slice(pos).concat(t.slice(0,pos)).join(','));}values=tris.sort();}return [a.getType(),a.getComponentType(),a.getNormalized(),crypto.createHash('sha256').update(JSON.stringify(values)).digest('hex')];}).sort(),nodes:r.listNodes().map(n=>[n.getName(),n.getTranslation(),n.getRotation(),n.getScale()]),animations:r.listAnimations().map(a=>a.getName()),textures:r.listTextures().map(t=>crypto.createHash('sha256').update(t.getImage()).digest('hex'))};}
for(const file of ['img/3d/tree/preview.glb','img/3d/tree/seed.glb']){
 const original=fs.readFileSync(root+file);
 if (JSON.parse(original.subarray(20,20+original.readUInt32LE(12))).extensionsUsed?.includes('EXT_meshopt_compression')) continue;
 const doc=await io.readBinary(original),before=signature(doc);
 doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({method:EXTMeshoptCompression.EncoderMethod.QUANTIZE});
 const output=await io.writeBinary(doc),decoded=await io.readBinary(output);
 if(JSON.stringify(before)!==JSON.stringify(signature(decoded)))throw Error('Model data changed: '+file);
 if(output.length>=original.length)throw Error('No savings: '+file);
 fs.writeFileSync(root+file,output);
 const row=report.models.find(r=>r.name===file); row.after=output.length;row.sha256=crypto.createHash('sha256').update(output).digest('hex');row.losslessMeshopt={before:original.length,after:output.length,decodedArraysUnchanged:true};
 console.log(file,original.length,output.length);
}
report.after=report.models.reduce((n,r)=>n+r.after,0);
fs.writeFileSync(root+'docs/model-compression.json',JSON.stringify(report,null,2)+'\n');
