import { CopyIcon, ExternalLinkIcon, UpdateIcon } from "@radix-ui/react-icons";
import { Button, Flex } from "@radix-ui/themes";
import _ from "lodash";
import { useCopyToClipboard, useLocalStorage } from "usehooks-ts";
import useNewTab from "../hooks/useNewTab";
import { type Setting } from "../models/Setting";
import type Widget from "../models/Widget";
import ConfigField from "./ConfigField";

interface ConfigFormProps<S extends readonly Setting<any>[]> {
  widget?: Widget<S>;
}

const ConfigForm = <S extends readonly Setting<any>[]>({ widget }: ConfigFormProps<S>) => {
  if (!widget) return <></>;

  const [config, setConfig] = useLocalStorage<Record<string, any>>("widget-config", {});
  const [_clipboard, copyToClipboard] = useCopyToClipboard();
  const newTab = useNewTab();

  const updateConfig = (k: string, v: any) => setConfig((o) => ({ ...o, [k]: v }));
  const clearConfig = () =>
    setConfig((o) => Object.fromEntries(Object.keys(o).map((k) => [k, ""])));

  const getWidgetURLParams = () => {
    const widgetSettingsIds = widget.settings.map((s) => s.id) || [];
    const widgetConfig = _.pick(config, widgetSettingsIds);
    return new URLSearchParams(widgetConfig);
  };
  const getRoute = () => `${widget.id}?${getWidgetURLParams().toString()}`;
  const getURL = () => `${location.href}${getRoute()}`;

  return (
    <Flex direction="column" gap="30px">
      <Flex direction="column">
        {widget.settings.map((setting) => (
          <ConfigField value={config[setting.id]} setting={setting} onValueChange={updateConfig} />
        ))}
      </Flex>
      <Flex gap="5px">
        <Button style={{ flex: 1 }} onClick={() => copyToClipboard(getURL())}>
          Get URL
          <CopyIcon />
        </Button>
        <Button variant="soft" onClick={() => newTab(getRoute())}>
          <ExternalLinkIcon />
        </Button>
        <Button variant="soft" onClick={clearConfig}>
          <UpdateIcon />
        </Button>
      </Flex>
    </Flex>
  );
};

export default ConfigForm;
