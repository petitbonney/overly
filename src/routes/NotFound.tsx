import { ArrowLeftIcon } from "@radix-ui/react-icons";
import { Flex, IconButton } from "@radix-ui/themes";
import { useLocation } from "preact-iso";

const NotFound = () => {
  const { route } = useLocation();

  return (
    <Flex justify="center" align="center" gap="10px">
      <IconButton variant="surface" onClick={() => route(import.meta.env.BASE_URL)}>
        <ArrowLeftIcon width="20" height="20" />
      </IconButton>
      <h1>Not Found</h1>
    </Flex>
  );
};

export default NotFound;
