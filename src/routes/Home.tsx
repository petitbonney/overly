import { Flex } from "@radix-ui/themes";
import _ from "lodash";
import { useEffect, useState } from "preact/compat";
import { useLocalStorage } from "usehooks-ts";
import AnimatedBackground from "../components/AnimatedBackground";
import ConfigForm from "../components/ConfigForm";
import WidgetSelector from "../components/WidgetSelector";
import WIDGETS from "../constants/widgets";

const Home = () => {
  const [selectedWidgetId, setSelectedWidgetId] = useLocalStorage("widget-id", WIDGETS[0].id);
  const findWidget = () => _.find(WIDGETS, (w) => w.id === selectedWidgetId);
  const [selectedWidget, setSelectedWidget] = useState(findWidget);

  useEffect(() => setSelectedWidget(findWidget), [selectedWidgetId]);

  return (
    <Flex height="100vh" justify="center" align="start">
      <AnimatedBackground />
      <Flex direction="column" gap="20px" width="50%" minWidth="500px" className="home-card glass">
        <WidgetSelector value={selectedWidgetId} onValueChange={setSelectedWidgetId} />
        <ConfigForm widget={selectedWidget} />
      </Flex>
    </Flex>
  );
};

export default Home;
