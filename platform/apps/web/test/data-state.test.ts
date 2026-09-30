import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import DataState from '../src/components/DataState.vue';

describe('DataState', () => {
  it('exposes an accessible loading state', () => {
    const wrapper = mount(DataState, {
      props: { isLoading: true },
    });

    expect(wrapper.get('[aria-busy="true"]').attributes('aria-label')).toBe(
      '正在加载',
    );
  });

  it('renders an alert and keyboard-accessible retry action on error', async () => {
    const wrapper = mount(DataState, {
      props: { isLoading: false, errorMessage: '网络连接失败' },
    });

    expect(wrapper.get('[role="alert"]').text()).toContain('网络连接失败');
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('retry')).toHaveLength(1);
  });

  it('announces a meaningful empty state', () => {
    const wrapper = mount(DataState, {
      props: {
        isLoading: false,
        isEmpty: true,
        emptyTitle: '暂无订单',
        emptyDescription: '完成购买后会显示在这里。',
      },
    });

    expect(wrapper.get('[role="status"]').text()).toContain('暂无订单');
    expect(wrapper.text()).toContain('完成购买后会显示在这里。');
  });
});
