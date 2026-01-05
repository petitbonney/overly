import { Theme } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import "normalize.css";
import { render } from "preact";
import { HashRouter, Route, Routes } from "react-router";
import "./index.css";
import Home from "./routes/Home";
import Loader from "./routes/Loader";
import NotFound from "./routes/NotFound";

const routing = (
  <HashRouter>
    <Routes>
      <Route index element={<Home />} />
      <Route path="/404" element={<NotFound />} />
      <Route path="/:id" element={<Loader />} />
    </Routes>
  </HashRouter>
);

render(<Theme>{routing}</Theme>, document.body);
