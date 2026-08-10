export interface NodeSocketFactoryOptions {
  wsSchema?: string;
  basePathname?: string;
  socketPath?: string | null;
}

export class NodeSocketFactory {
  constructor(options: NodeSocketFactoryOptions);
}
