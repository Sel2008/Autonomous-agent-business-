import { discoverViaExa } from "../discovery";

export type BootstrapProvider = {
  id:string;
  name:string;
  discoveryQuery:string;
  discover:()=>Promise<Awaited<ReturnType<typeof discoverViaExa>>>;
};

export const BOOTSTRAP_PROVIDERS:BootstrapProvider[] = [
  {
    id:"web-research",
    name:"Open-web opportunity discovery",
    discoveryQuery:"legitimate online paid work zero upfront payout official provider automation API remote tasks",
    discover:()=>discoverViaExa("legitimate online paid work zero upfront payout official provider automation API remote tasks")
  }
];
