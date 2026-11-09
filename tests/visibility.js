const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert/strict');
const create=require('../bulkrunner'), root=fs.mkdtempSync(path.join(os.tmpdir(),'br-list-')); let messages=[];
const nodes=[{_id:'node/a/1',meshid:'mesh/a/1',name:'visible'},{_id:'node/a/2',meshid:'mesh/a/2',name:'private'},{_id:'node/b/3',meshid:'mesh/b/3'}];
const meshes=[{_id:'mesh/a/1',name:'visible'},{_id:'mesh/a/2',name:'private'}];
const server={datapath:root,db:{GetAllType(t,cb){cb(null,t==='node'?nodes:meshes);}},webserver:{wsagents:{},GetNodeWithRights(d,u,id,cb){const n=nodes.find(x=>x._id===id);cb(n,0,id==='node/a/1');}}};
const client={user:{_id:'user/a/admin',siteadmin:-1},domain:{id:'a'},ws:{send(s){messages.push(JSON.parse(s));}}};
create({parent:server}).serveraction({pluginaction:'list'},client);
setImmediate(()=>{const reply=messages.at(-1);assert.deepEqual(reply.nodes.map(x=>x.name),['visible']);assert.deepEqual(reply.meshes.map(x=>x.name),['visible']);console.log('Target visibility passed');});
