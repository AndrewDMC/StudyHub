import { loadFont } from "@remotion/google-fonts/Inter";

export const { fontFamily } = loadFont("normal", {
  weights: ["400", "600", "800"],
  subsets: ["latin"],
});

export const colors = {
  bg: "#0b0c10",
  panel: "#14161d",
  line: "#262a35",
  text: "#f4f5f7",
  muted: "#9aa1b2",
  accent: "#5b8cff",
  green: "#3ddc97",
};
