import { KanaApp } from "@/components/kana/kana-app";
import packageJson from "@/package.json";

export default function Home() {
  return <KanaApp appVersion={packageJson.version} />;
}
