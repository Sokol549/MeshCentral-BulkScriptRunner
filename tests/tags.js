const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert/strict');
const create = require('../bulkrunner');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'br-tag-test-')); let output, plugin, messages = [], currentTags = ['existing'];
const node = { _id:'node/a/1', name:'test', meshid:'mesh/a/1', agent:{id:2}, tags:currentTags };
const agent = { authenticated:2, dbNodeKey:node._id, send(s){output=JSON.parse(s);} };
const web = { wsagents:{[node._id]:agent}, GetNodeWithRights(domain,user,id,cb){cb(node,0x20004,true);}, cleanDevice(n){return n;}, CloneSafeNode(n){return n;}, CreateNodeDispatchTargets(){return [];} };
const server={datapath:root,webserver:web,db:{Set(n,cb){currentTags=n.tags;cb();}},DispatchEvent(){}};
const client={user:{_id:'user/a/admin',siteadmin:-1,name:'admin'},domain:{id:'a'},ws:{send(s){messages.push(JSON.parse(s));}}};
plugin=create({parent:server});
plugin.serveraction({pluginaction:'run',nodeids:[node._id],target_os:'windows',script:'echo ok',workers:1,timeout:20,success_tag:'done'},client);
setImmediate(()=>{
 plugin.serveraction({pluginaction:'agentResult',event:'finished',attempt:output.attempt,exitCode:0,stdout:'ok',stderr:''},agent);
 setImmediate(()=>{
  assert.deepEqual(currentTags,['done','existing']);
  const task=messages.filter(x=>x.type==='task').at(-1).task;
  assert.equal(task.results[0].tag_status,'Applied');
  plugin.serveraction({pluginaction:'untag',task_id:task.task_id,tag:'done'},client);
  setImmediate(()=>{assert.deepEqual(currentTags,['existing']);assert.equal(messages.at(-1).changed,1);console.log('Tag integration passed');});
 });
});
