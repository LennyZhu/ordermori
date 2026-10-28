import { useLocalSearchParams } from 'expo-router';
import { OrderEditor } from '../../../src/ui/OrderEditor';
export default function EditOrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <OrderEditor orderId={id} />;
}
