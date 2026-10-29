import { Directory, Paths } from 'expo-file-system';
import { DomainError } from '../domain/model';
let generation = '';
export function setMediaGeneration(value: string) {
  if (value !== '' && !/^[a-f0-9-]{36}$/.test(value)) throw new DomainError('backup', '本機圖片目錄記錄無效，未清除資料。');
  generation = value;
}
export function businessMediaRoot() {
  return generation ? new Directory(Paths.document, 'ordermori', 'restored', generation) : new Directory(Paths.document, 'ordermori');
}
