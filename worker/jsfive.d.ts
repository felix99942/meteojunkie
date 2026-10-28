// jsfive bringt keine Typen mit; benutzt wird nur `File` und `get()` —
// alles Weitere ist in worker/radar.ts lokal typisiert.
declare module 'jsfive' {
  export class File {
    constructor(buffer: ArrayBuffer, filename: string)
    get(path: string): unknown
  }
}
