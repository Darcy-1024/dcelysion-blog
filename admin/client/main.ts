import { mount } from "svelte";
import App from "./App.svelte";
import "./style.css";

const target = document.getElementById("app");
if (!target) throw new Error("后台入口不存在");
mount(App, { target });
