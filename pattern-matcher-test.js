'use strict';
const assert=require('node:assert/strict');
const {create}=require('./pattern-matcher.js');
const rows=[
 {id:'same-id',symbol:'BTC',name:'Bitcoin',rank:1,status:'ok'},
 {id:'gecko-eth',symbol:'ETH',name:'Ethereum',rank:2,status:'ok'},
 {id:'gecko-abc-a',symbol:'ABC',name:'Alpha Coin',rank:10,status:'ok'},
 {id:'gecko-abc-b',symbol:'ABC',name:'Beta Coin',rank:11,status:'ok'},
 {id:'gecko-amb-a',symbol:'DUP',name:'Duplicate A',rank:20,status:'ok'},
 {id:'gecko-amb-b',symbol:'DUP',name:'Duplicate B',rank:20,status:'ok'}
];
const coins=[
 {id:'same-id',symbol:'BTC',name:'Bitcoin',market_cap_rank:1},
 {id:'different-eth-id',symbol:'ETH',name:'Ethereum',market_cap_rank:2},
 {id:'different-alpha-id',symbol:'ABC',name:'Alpha Coin',market_cap_rank:10},
 {id:'different-beta-id',symbol:'ABC',name:'Beta Coin',market_cap_rank:11},
 {id:'different-duplicate-id',symbol:'DUP',name:'Unknown duplicate',market_cap_rank:20}
];
const m=create(coins,rows);
assert.equal(m.find(coins[0],coins[0].id).id,'same-id','exact ID');
assert.equal(m.find(coins[1],coins[1].id).id,'gecko-eth','symbol + name');
assert.equal(m.find(coins[2],coins[2].id).id,'gecko-abc-a','duplicate symbol resolved by rank');
assert.equal(m.find(coins[3],coins[3].id).id,'gecko-abc-b','second duplicate symbol resolved by rank');
assert.equal(m.find(coins[4],coins[4].id),null,'ambiguous duplicate must not be guessed');
const m2=create([coins[0]],rows);
assert.equal(m2.find(coins[0],coins[0].id).id,'same-id');
assert.equal(m2.find(coins[0],coins[0].id),null,'one server result cannot be assigned twice');
console.log('Pattern result matching self-test: 6 assertions passed');
