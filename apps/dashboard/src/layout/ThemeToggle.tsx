import { Button, Menu, type MantineColorScheme, useMantineColorScheme } from '@mantine/core';

const CHOICES: { value: MantineColorScheme; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'auto', label: 'Auto' },
];

export function ThemeToggle() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  return (
    <Menu position="bottom-end">
      <Menu.Target>
        <Button variant="default" size="xs">
          Theme
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        {CHOICES.map(({ value, label }) => (
          <Menu.Item
            key={value}
            onClick={() => {
              setColorScheme(value);
            }}
            fw={value === colorScheme ? 700 : undefined}
          >
            {label}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
