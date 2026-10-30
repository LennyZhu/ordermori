import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { OrderStore } from '../../src/data/store.ts';
const db=new DatabaseSync(workerData.path);
const port={exec:async s=>db.exec(s),run:async(s,p=[])=>db.prepare(s).run(...p),first:async(s,p=[])=>db.prepare(s).get(...p)??null,all:async(s,p=[])=>db.prepare(s).all(...p)};
try{const store=new OrderStore(port,randomUUID,()=>workerData.now);await store.initialize();parentPort.postMessage({id:await store.createOrder(workerData.requestId,workerData.input)});}
catch(error){parentPort.postMessage({error:error.message});}
finally{db.close();}
