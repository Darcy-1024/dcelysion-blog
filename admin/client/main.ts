import { mount } from "svelte";
import App from "./App.svelte";
import "./icons";
import "./style.css";
import "./theme.css";

const target = document.getElementById("app");
if (!target) throw new Error("后台入口不存在");
mount(App, { target });
