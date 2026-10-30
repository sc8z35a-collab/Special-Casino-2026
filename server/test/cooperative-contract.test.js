import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startServer} from './helpers.js';
import {cooperativeContract} from '../../tools/cooperative-contract.cjs';
test('real HTTP watch bets keep tokens and the bet slot on a quest VIP wage overflow, then retry once',async t=>{
  const admin='cooperative-contract-'+'a'.repeat(24),s=await startServer({quests:true,adminToken:admin});t.after(()=>s.stop());
  assert.equal((await cooperativeContract(s.base,admin)).length,4);
});
