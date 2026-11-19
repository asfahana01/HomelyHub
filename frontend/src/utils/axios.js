//centeralized API setup

import axios from 'axios';
import qs from 'qs';

export const axiosInstance = axios.create({
    baseURL: '/api',
    withCredentials: true,
    paramsSerializer: params => qs.stringify(params, { arrayFormat: 'repeat' }),
})

let refreshRequest;

axiosInstance.interceptors.response.use(
    response => response,
    async error => {
        const request = error.config;
        const authEndpoints = [
            '/v1/rent/user/login',
            '/v1/rent/user/signup',
            '/v1/rent/user/refresh-token',
            '/v1/rent/user/forgotPassword',
            '/v1/rent/user/resetPassword/',
        ];
        const isAuthEndpoint = authEndpoints.some(endpoint =>
            request?.url?.includes(endpoint)
        );

        if (
            error.response?.status !== 401 ||
            !request ||
            request._retry ||
            isAuthEndpoint
        ) {
            return Promise.reject(error);
        }

        request._retry = true;
        try {
            if (!refreshRequest) {
                refreshRequest = axiosInstance
                    .post('/v1/rent/user/refresh-token')
                    .finally(() => {
                        refreshRequest = undefined;
                    });
            }
            await refreshRequest;
            return axiosInstance(request);
        } catch (refreshError) {
            return Promise.reject(refreshError);
        }
    }
);

