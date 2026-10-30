import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startServer} from './helpers.js';
import {vaultAccessContract} from '../../tools/vault-access-contract.cjs';
test('real HTTP vault links preserve exact allowance, quota limits and revocation',async t=>{
  const s=await startServer({operators:['taku'],vaultSnapshots:false});t.after(()=>s.stop());
  assert.equal((await vaultAccessContract(s.base)).length,4);
});
