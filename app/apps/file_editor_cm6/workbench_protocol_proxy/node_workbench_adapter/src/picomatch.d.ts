declare module "picomatch" {
  interface PicomatchOptions {
    dot?: boolean;
  }

  export default function picomatch(
    pattern: string,
    options?: PicomatchOptions,
  ): (value: string) => boolean;
}
