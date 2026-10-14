export interface TestZipFile { name: string; data?: string; mode?: number; declaredSize?: number }
function crc32(data: Buffer): number {
  let value = 0xffffffff
  for (const byte of data) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0) }
  return (value ^ 0xffffffff) >>> 0
}
export function testZip(files: TestZipFile[]): Uint8Array<ArrayBuffer> {
  const locals: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const file of files) {
    const name = Buffer.from(file.name)
    const data = Buffer.from(file.data ?? '')
    const size = file.declaredSize ?? data.length
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4)
    local.writeUInt32LE(crc32(data), 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(size, 22); local.writeUInt16LE(name.length, 26)
    locals.push(local, name, data)
    const header = Buffer.alloc(46)
    header.writeUInt32LE(0x02014b50); header.writeUInt16LE(0x0314, 4); header.writeUInt16LE(20, 6)
    header.writeUInt32LE(crc32(data), 16); header.writeUInt32LE(data.length, 20); header.writeUInt32LE(size, 24); header.writeUInt16LE(name.length, 28)
    header.writeUInt32LE(((file.mode ?? 0o100644) << 16) >>> 0, 38); header.writeUInt32LE(offset, 42)
    central.push(header, name); offset += local.length + name.length + data.length
  }
  const directories = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(directories.length, 12); end.writeUInt32LE(offset, 16)
  return new Uint8Array(Buffer.concat([...locals, directories, end]))
}
