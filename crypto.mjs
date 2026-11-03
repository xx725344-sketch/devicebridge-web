const encoder = new TextEncoder();
export function encode64(bytes) {
  let text = '';
  for (let i=0;i<bytes.length;i+=8192) text += String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(text).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
export function decode64(text) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]+$/.test(text)) throw Error('连接密钥或消息格式不正确。');
  return Uint8Array.from(atob(text.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
}
export async function hexHash(value) {
  const bytes = typeof value==='string' ? encoder.encode(value) : value;
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
}
export async function createKeys(master) {
  const bytes=decode64(master);
  if(bytes.length!==32)throw Error('请输入电脑显示的完整连接密钥（43 位）。');
  const material=await crypto.subtle.importKey('raw',bytes,'HKDF',false,['deriveBits']);
  const derive=async label=>new Uint8Array(await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt:encoder.encode('DeviceBridge cloud v1'),info:encoder.encode(label)},material,256));
  const request=await crypto.subtle.importKey('raw',await derive('request'),{name:'AES-GCM'},false,['encrypt','decrypt']);
  const response=await crypto.subtle.importKey('raw',await derive('response'),{name:'AES-GCM'},false,['encrypt','decrypt']);
  return { request,response,clientToken:encode64(await derive('client-auth')) };
}
export async function seal(keys,direction,payload) {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const data=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode('DeviceBridge-v1:'+direction)},keys[direction],encoder.encode(JSON.stringify(payload)));
  return {v:1,iv:encode64(iv),data:encode64(new Uint8Array(data))};
}
export async function unseal(keys,direction,packet) {
  if(packet?.v!==1 || typeof packet.data!=='string' || packet.data.length>190000)throw Error('消息格式不正确。');
  const iv=decode64(packet.iv);if(iv.length!==12)throw Error('消息格式不正确。');
  const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:encoder.encode('DeviceBridge-v1:'+direction)},keys[direction],decode64(packet.data));
  return JSON.parse(new TextDecoder().decode(plaintext));
}
export function newKey(){ return encode64(crypto.getRandomValues(new Uint8Array(32))); }
