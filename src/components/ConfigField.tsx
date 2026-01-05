import { ExternalLinkIcon, InfoCircledIcon } from "@radix-ui/react-icons";
import { Button, Flex, IconButton, Popover } from "@radix-ui/themes";
import { Label } from "radix-ui";
import { TextFieldConfigurator, type Setting } from "../models/Setting";

interface ConfigFieldProps<S extends Setting<any>> {
  setting: S;
  value?: any;
  onValueChange?: (id: string, v: any) => void;
}

const ConfigField = <S extends Setting<any>>({
  setting,
  value,
  onValueChange,
}: ConfigFieldProps<S>) => {
  return (
    <Flex direction="column">
      <Flex align="center" gap="5px">
        <div>
          <Label.Root style={{ fontWeight: "bold", fontStyle: "italic" }}>{setting.id}</Label.Root>
          {setting.required && <Label.Root style={{ color: "brown" }}>*</Label.Root>}
        </div>

        {setting.hint && (
          <Popover.Root>
            <Popover.Trigger>
              <IconButton variant="ghost" color="gray" size="1">
                <InfoCircledIcon />
              </IconButton>
            </Popover.Trigger>
            <Popover.Content>
              <Flex direction="column" gap="5px">
                {setting.hint}
                {setting.hintLink && (
                  <Button variant="outline" onClick={() => window.open(setting.hintLink, "_blank")}>
                    {setting.hintLink} <ExternalLinkIcon />
                  </Button>
                )}
              </Flex>
            </Popover.Content>
          </Popover.Root>
        )}
      </Flex>
      {setting.render
        ? setting.render({
            value: value,
            onValueChange: (v) => onValueChange && onValueChange(setting.id, v),
          })
        : TextFieldConfigurator({
            value: value,
            onValueChange: (v) => onValueChange && onValueChange(setting.id, v),
          })}
    </Flex>
  );
};

export default ConfigField;
