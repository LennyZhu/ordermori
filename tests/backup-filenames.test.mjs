import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { backupFileName, isBackupFileName, BACKUP_PICKER_OPTIONS, BACKUP_SHARE_OPTIONS } from '../src/backup/fileNames.ts';
import { writeArchive, inspectArchive, copyEntry } from '../src/backup/archive.ts';
import { parseManifest, verifySummary } from '../src/backup/manifest.ts';
import { checkSchema, readBackupData, validateData } from '../src/backup/data.ts';
import { OrderStore } from '../src/data/store.ts';
import { SCHEMA_VERSION } from '../src/data/migrations.ts';

const port=db=>({exec:async sql=>db.exec(sql),run:async(sql,p=[])=>db.prepare(sql).run(...p),first:async(sql,p=[])=>db.prepare(sql).get(...p)??null,all:async(sql,p=[])=>db.prepare(sql).all(...p)});
const source=bytes=>({size:bytes.length,read:async(at,n)=>new Uint8Array(bytes.subarray(at,at+n))});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const reference=async()=>{const db=new DatabaseSync(':memory:');return {db:port(db),close:async()=>db.close()};};

test('new export name already has the ZIP suffix matching the actual iOS MIME/UTI',()=>{
  const name=backupFileName('2026-10-29T12:34:56.000Z');
  assert.equal(name,'OrderMori-Backup-20261029.ordermori.zip');assert.equal(isBackupFileName(name),true);
  assert.equal(BACKUP_SHARE_OPTIONS.mimeType,'application/zip');assert.equal(BACKUP_SHARE_OPTIONS.UTI,'public.zip-archive');
});

test('picker allows both extensions and filename identification accepts legacy and iOS ZIP names only',()=>{
  assert.deepEqual(BACKUP_PICKER_OPTIONS,{type:'*/*',copyToCacheDirectory:true,multiple:false});
  for(const name of ['OrderMori-Backup-20261029.ordermori','OrderMori-Backup-20261029.ordermori.zip','先前備份.ORDERMORI.ZIP','備份 (1).ordermori.zip'])assert.equal(isBackupFileName(name),true,name);
  for(const name of ['backup.zip','backup.ordermori.zip.exe','backup.ordermori.zip.zip','../backup.ordermori','/backup.ordermori','dir\\backup.ordermori.zip','backup.ordermori\n',''])assert.equal(isBackupFileName(name),false,name);
});

test('new export and existing .ordermori.zip/.ordermori files reimport the same actual SQLite archive without renaming or unpacking',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'ordermori-backup-extension-')),databasePath=join(dir,'source.sqlite');let db=new DatabaseSync(databasePath);
  try{
    await new OrderStore(port(db),randomUUID).initialize();const data=await readBackupData(port(db)),summary=validateData(data);
    // Close this isolated fixture before reading its checkpointed main file.
    db.close();db=null;const databaseBytes=readFileSync(databasePath);
    const manifest={format:'OrderMori',version:1,createdAt:'2026-10-29T12:34:56.000Z',schemaVersion:SCHEMA_VERSION,summary,files:[{path:'data.sqlite',size:databaseBytes.length,sha256:sha(databaseBytes)}]};
    const chunks=[];await writeArchive([{path:'manifest.json',source:source(Buffer.from(JSON.stringify(manifest)))},{path:'data.sqlite',source:source(databaseBytes)}],{write:async bytes=>{chunks.push(Buffer.from(bytes));}});
    const bytes=Buffer.concat(chunks);
    for(const name of [backupFileName(manifest.createdAt),'Existing-iOS-Backup.ordermori.zip','Legacy-Backup.ordermori']){
      assert.equal(isBackupFileName(name),true);const archivePath=join(dir,name);writeFileSync(archivePath,bytes);
      const importedSource=source(readFileSync(archivePath)),entries=await inspectArchive(importedSource),contents={};
      for(const entry of entries){const out=[];await copyEntry(importedSource,entry,{write:async b=>{out.push(Buffer.from(b));}});contents[entry.path]=Buffer.concat(out);}
      const parsed=parseManifest(contents['manifest.json'].toString(),entries);verifySummary(parsed,summary);
      assert.equal(sha(contents['data.sqlite']),parsed.files[0].sha256);
      const path=join(dir,randomUUID()+'.sqlite');writeFileSync(path,contents['data.sqlite']);const restored=new DatabaseSync(path);
      try{assert.equal(await checkSchema(port(restored),reference),SCHEMA_VERSION);assert.deepEqual(await readBackupData(port(restored)),data);}finally{restored.close();}
    }
    // A recognized filename never makes non-ZIP/corrupt content valid.
    for(const name of ['corrupt.ordermori','corrupt.ordermori.zip']){
      assert.equal(isBackupFileName(name),true);await assert.rejects(inspectArchive(source(Buffer.from('not an OrderMori backup'))));
      const corrupt=Buffer.from(bytes);const entries=await inspectArchive(source(corrupt));corrupt[entries.find(e=>e.path==='data.sqlite').offset]^=1;
      await assert.rejects(copyEntry(source(corrupt),entries.find(e=>e.path==='data.sqlite'),{write:async()=>{}}));
    }
  }finally{db?.close();rmSync(dir,{recursive:true,force:true});}
});
